import { useControl } from './control/useControl.js';
import { Composer } from './control/Composer.js';
import { MessageSquare, List, Files, ChartNoAxesColumn } from 'lucide-react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useBreadcrumbs } from './shell/breadcrumbs.js';
import { useProject, useSession, useSessionPoll } from './api.js';
import { SessionChanges } from './files/SessionChanges.js';
import { Failure, Loading } from './ui.js';
import { Conversation } from './session/Conversation.js';
import { Sidebar, Subagents } from './session/Sidebar.js';
import { Outline } from './session/Navigation.js';
import { ContextUsage } from './session/ContextUsage.js';
import { SessionHeader } from './session/header/SessionHeader.js';
import { SessionSearch } from './session/header/SessionSearch.js';
import { contextUsage } from './session/context.js';
import { useQueryClient } from '@tanstack/react-query';
import { useMachineId } from './machine.js';
import { refreshSession } from './live/index.js';
import { scrollConversationToBottom } from './session/WindowedMessages.js';
import { buildSearchIndex, searchableText } from './session/model.js';
export { Conversation } from './session/Conversation.js';

export function SessionPage(props: { projectId: string; sessionId: string }) {
  return (
    <SessionView
      key={`${useMachineId()}/${props.projectId}/${props.sessionId}`}
      {...props}
    />
  );
}

function SessionView({
  projectId,
  sessionId,
}: {
  projectId: string;
  sessionId: string;
}) {
  const machineId = useMachineId();
  const control = useControl();
  const query = useSession(projectId, sessionId);
  const client = useQueryClient();
  const loadingOlder = useRef(false);
  const refreshedTotal = useRef<number | undefined>(undefined);
  const poll = useSessionPoll(projectId, sessionId);
  const project = useProject(projectId);
  const projectLabel =
    project.data?.project.name ?? (project.isPending ? '…' : projectId);
  useBreadcrumbs([
    { label: 'Overview', to: '/m/$machineId' },
    {
      label: projectLabel,
      to: `/projects/${encodeURIComponent(projectId)}`,
    },
    { label: query.data?.pages.at(-1)?.session.title || 'Session' },
  ]);
  const [requestedTool, setRequestedTool] = useState<string>();
  const [target, setTarget] = useState<string>();
  const [jumpVersion, setJumpVersion] = useState(0);
  const [loadingLatest, setLoadingLatest] = useState(false);
  const [toolTarget, setToolTarget] = useState<string>();
  const [notice, setNotice] = useState('');
  const attempts = useRef(0);
  const [mobileTab, setMobileTab] = useState<
    'chat' | 'outline' | 'files' | 'usage'
  >('chat');
  const [requestedAgent, setRequestedAgent] = useState<{ id: string }>();
  const [narrow, setNarrow] = useState(
    () => window.matchMedia?.('(max-width: 1023px)').matches ?? false,
  );
  const [search, setSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchButton = useRef<HTMLButtonElement | null>(null);
  const deferredSearch = useDeferredValue(search);
  const normalizedSearch = deferredSearch.trim().toLocaleLowerCase();
  const [active, setActive] = useState<string>();
  const [searching, setSearching] = useState(false);
  const searchGeneration = useRef(0);
  const messages = useMemo(
    () => [
      ...new Map(
        (query.data?.pages ?? [])
          .flatMap((p) => p.messages)
          .map((m) => [m.uuid, m]),
      ).values(),
    ],
    [query.data],
  );
  const lastResponse = useMemo(() => {
    const reply = messages.findLast(
      (m) =>
        m.role === 'assistant' &&
        !m.isSidechain &&
        !m.isMeta &&
        m.blocks.some((b) => b.type === 'text' && b.text.trim()),
    );
    return reply?.blocks
      .flatMap((b) => (b.type === 'text' ? [b.text] : []))
      .join('\n\n');
  }, [messages]);
  const searchIndex = useMemo(() => buildSearchIndex(messages), [messages]);
  const matches = useMemo(
    () =>
      normalizedSearch
        ? searchIndex
            .filter((entry) => entry.text.includes(normalizedSearch))
            .map((entry) => entry.message)
        : [],
    [searchIndex, normalizedSearch],
  );
  const finishJump = useCallback(() => {
    setTarget(undefined);
    setToolTarget(undefined);
  }, []);
  const fetchNextPage = query.fetchNextPage;
  const fetchPreviousPage = query.fetchPreviousPage;
  const isFetching = query.isFetching;
  const hasNext = query.hasNextPage;
  const hasPrevious = query.hasPreviousPage;
  const pages = query.data;
  const error = query.error;
  const loadOlder = useCallback(
    async (reason: 'auto' | 'user') => {
      if (!hasPrevious || isFetching || loadingOlder.current) return;
      if (
        reason === 'auto' &&
        (query.isFetchPreviousPageError || target || searching)
      )
        return;
      loadingOlder.current = true;
      try {
        await fetchPreviousPage({ cancelRefetch: false });
      } finally {
        loadingOlder.current = false;
      }
    },
    [
      hasPrevious,
      isFetching,
      query.isFetchPreviousPageError,
      target,
      searching,
      fetchPreviousPage,
    ],
  );
  const onNearTop = useCallback(() => void loadOlder('auto'), [loadOlder]);
  function jump(id: string, tool = false) {
    attempts.current = 0;
    setJumpVersion((n) => n + 1);
    setNotice('');
    setTarget(id);
    setToolTarget(tool ? id : undefined);
    setMobileTab('chat');
    window.history.replaceState(
      window.history.state,
      '',
      tool ? `#tool-${encodeURIComponent(id)}` : `#m-${id}`,
    );
  }
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 1023px)');
    const change = () => setNarrow(media?.matches ?? false);
    media?.addEventListener?.('change', change);
    return () => media?.removeEventListener?.('change', change);
  }, []);
  useEffect(() => {
    const readHash = () => {
      const hash = window.location.hash;
      setJumpVersion((n) => n + 1);
      if (hash.startsWith('#m-')) {
        attempts.current = 0;
        setTarget(hash.slice(3));
        setToolTarget(undefined);
      } else if (hash.startsWith('#tool-')) {
        const id = decodeURIComponent(hash.slice(6));
        attempts.current = 0;
        setTarget(id);
        setToolTarget(id);
      }
    };
    readHash();
    window.addEventListener('hashchange', readHash);
    return () => window.removeEventListener('hashchange', readHash);
  }, [projectId, sessionId]);
  const targetFound = messages.some(
    (m) =>
      m.uuid === target ||
      m.blocks.some((b) => b.type === 'tool_use' && b.id === target),
  );
  useEffect(() => {
    const targetMissing =
      !!target &&
      !!pages &&
      !targetFound &&
      !isFetching &&
      (query.isFetchPreviousPageError ||
        !hasPrevious ||
        attempts.current >= 19);
    if (!targetMissing) return;
    // Report the terminal miss before clearing the target so live tailing resumes.
    setNotice(
      'Message not found in loaded pages; jumps load at most 20 pages.',
    );
    setTarget(undefined);
    setToolTarget(undefined);
  }, [
    target,
    pages,
    targetFound,
    isFetching,
    query.isFetchPreviousPageError,
    hasPrevious,
  ]);
  useEffect(() => {
    if (
      !target ||
      !pages ||
      messages.some(
        (m) =>
          m.uuid === target ||
          m.blocks.some((b) => b.type === 'tool_use' && b.id === target),
      )
    )
      return;
    if (
      hasPrevious &&
      !isFetching &&
      !query.isFetchPreviousPageError &&
      attempts.current < 19
    ) {
      attempts.current++;
      void fetchPreviousPage({ cancelRefetch: false });
    }
  }, [
    target,
    pages,
    messages,
    hasPrevious,
    isFetching,
    query.isFetchPreviousPageError,
    fetchPreviousPage,
  ]);
  useEffect(() => {
    if (hasNext && !isFetching && !target && !query.isFetchNextPageError)
      void fetchNextPage({ cancelRefetch: false });
  }, [hasNext, isFetching, fetchNextPage, target, query.isFetchNextPageError]);
  useEffect(() => {
    const newest = pages?.pages.at(-1);
    const total = poll.data?.totalMessages;
    if (
      newest &&
      !newest.messages.length &&
      total !== undefined &&
      total > newest.totalMessages &&
      refreshedTotal.current !== total &&
      !isFetching &&
      !target
    ) {
      refreshedTotal.current = total;
      void refreshSession(client, machineId, projectId, sessionId);
    }
  }, [
    pages,
    poll.data?.totalMessages,
    isFetching,
    target,
    client,
    projectId,
    sessionId,
    machineId,
  ]);
  async function navigateMatch(direction: 1 | -1) {
    const generation = searchGeneration.current;
    const index = matches.findIndex((m) => m.uuid === active);
    let list = matches;
    let capped = false;
    const needsPages =
      hasPrevious &&
      (direction === -1
        ? index === 0 || !matches.length
        : index === matches.length - 1 || !matches.length);
    if (needsPages) {
      setSearching(true);
      try {
        const known = new Set(messages.map((m) => m.uuid));
        for (let page = 0; page < 20; page++) {
          const result = await fetchPreviousPage({ cancelRefetch: false });
          if (generation !== searchGeneration.current) return;
          if (result.error) throw result.error;
          const found = (result.data?.pages[0]?.messages ?? []).filter((m) => {
            if (known.has(m.uuid)) return false;
            known.add(m.uuid);
            return searchableText(m)
              .toLocaleLowerCase()
              .includes(normalizedSearch);
          });
          list = [...found, ...list];
          if (direction === -1 && found.length) {
            setActive(found.at(-1)!.uuid);
            jump(found.at(-1)!.uuid);
            return;
          }
          if (!result.hasPreviousPage) break;
          if (page === 19) capped = true;
        }
        if (capped) setNotice('Searched up to 20 pages; more messages remain.');
        else if (!list.length)
          setNotice('No further match found (up to 20 pages searched).');
      } catch (e) {
        setNotice(e instanceof Error ? e.message : 'Search failed.');
        return;
      } finally {
        setSearching(false);
      }
    }
    const match =
      list[
        needsPages && direction === 1
          ? 0
          : index < 0
            ? direction === -1
              ? list.length - 1
              : 0
            : (index + direction + list.length) % list.length
      ];
    if (match) {
      setActive(match.uuid);
      jump(match.uuid);
      if (capped) setNotice('Searched up to 20 pages; more messages remain.');
    }
  }
  async function jumpLatest() {
    setLoadingLatest(true);
    try {
      let remaining = hasNext;
      for (let page = 0; page < 20 && remaining; page++) {
        const result = await fetchNextPage({ cancelRefetch: false });
        if (result.error) throw result.error;
        remaining = result.hasNextPage;
      }
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}`,
      );
      setTarget(undefined);
      setToolTarget(undefined);
      const node = document.querySelector<HTMLElement>(
        '.session-page .conversation-window',
      );
      if (node) scrollConversationToBottom(node);
      if (remaining)
        setNotice(
          'Loaded 20 pages; more messages remain. Jump again to continue.',
        );
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : 'Could not load latest messages.',
      );
    } finally {
      setLoadingLatest(false);
    }
  }
  const [scrolledUp, setScrolledUp] = useState(false);
  const focusTabPending = useRef(false);
  useEffect(() => {
    document.documentElement.classList.add('session-route');
    return () => document.documentElement.classList.remove('session-route');
  }, []);
  useEffect(() => {
    if (!focusTabPending.current) return;
    focusTabPending.current = false;
    const panel =
      mobileTab === 'chat'
        ? document.querySelector('.session-conversation-column')
        : document.querySelector('.session-sidebar');
    [...(panel?.querySelectorAll<HTMLElement>('h1, h2') ?? [])]
      .find((heading) => !heading.closest('[hidden]'))
      ?.focus();
  }, [mobileTab]);
  const switchTab = (tab: typeof mobileTab) => {
    if (tab === mobileTab) return;
    focusTabPending.current = true;
    setMobileTab(tab);
  };
  useEffect(() => {
    const update = (event: Event) => {
      const node = event.target;
      if (
        node instanceof HTMLElement &&
        node.classList.contains('conversation-window')
      )
        setScrolledUp(
          node.scrollHeight - node.scrollTop - node.clientHeight > 200,
        );
      else if (node === document || node === document.documentElement)
        setScrolledUp(
          document.documentElement.scrollHeight -
            window.scrollY -
            window.innerHeight >
            300,
        );
    };
    window.addEventListener('scroll', update, true);
    return () => window.removeEventListener('scroll', update, true);
  }, []);
  if (error && !pages) return <Failure error={error} retry={query.refetch} />;
  const data = pages?.pages.at(-1);
  if (!data) return <Loading />;
  const sidebar = (
    <>
      <div hidden={narrow && mobileTab !== 'outline'}>
        <Outline
          messages={messages}
          jump={(id) => jump(id)}
          hasEarlier={hasPrevious}
          loadingEarlier={query.isFetchingPreviousPage}
          loadEarlier={() => void loadOlder('user')}
        />
      </div>
      <div hidden={narrow && mobileTab !== 'files'}>
        <SessionChanges
          projectId={projectId}
          sessionId={sessionId}
          requestedTool={requestedTool}
          dismiss={() => setRequestedTool(undefined)}
          jump={(id) => jump(id, true)}
        />
      </div>
      <div hidden={narrow && mobileTab !== 'usage'} className="space-y-4">
        <ContextUsage messages={messages} />
        <Subagents
          data={data}
          messages={messages}
          jump={(id) => jump(id, true)}
          requestedAgent={requestedAgent}
        />
        <Sidebar data={data} projectId={projectId} sessionId={sessionId} />
      </div>
    </>
  );
  return (
    <div className="session-page gap-5">
      <SessionHeader
        ownedRun={
          control.ready
            ? control.data?.runs.find(
                (run) =>
                  run.projectId === projectId && run.sessionId === sessionId,
              )
            : undefined
        }
        data={data}
        projectName={projectLabel}
        status={poll.data?.status ?? data.session.status}
        projectId={projectId}
        sessionId={sessionId}
        usage={contextUsage(messages)}
        searchOpen={searchOpen}
        toggleSearch={() => setSearchOpen((open) => (search ? true : !open))}
        searchButton={(button) => (searchButton.current = button)}
        notice={setNotice}
      />
      {searchOpen && (
        <SessionSearch
          search={search}
          change={(value) => {
            searchGeneration.current++;
            setSearch(value);
            setActive(undefined);
          }}
          matches={matches.length}
          selected={
            active ? matches.findIndex((m) => m.uuid === active) + 1 : null
          }
          disabled={
            !normalizedSearch ||
            search !== deferredSearch ||
            searching ||
            isFetching
          }
          previous={() => void navigateMatch(-1)}
          next={() => void navigateMatch(1)}
          projectId={projectId}
          close={() => {
            setSearchOpen(false);
            searchButton.current?.focus();
          }}
        />
      )}
      {notice && (
        <p className="flex-none" role="status">
          {notice}
        </p>
      )}
      <div className="session-layout">
        <div
          id="session-conversation"
          className="session-conversation-column min-w-0"
          hidden={narrow && mobileTab !== 'chat'}
        >
          <Conversation
            trailing={!hasNext}
            startAtBottom
            onNearTop={onNearTop}
            isFetching={isFetching}
            edge={{
              hasEarlier: hasPrevious,
              loading: query.isFetchingPreviousPage,
              error: query.isFetchPreviousPageError,
              load: () => void loadOlder('user'),
            }}
            footer={
              query.isFetchNextPageError ? (
                <Failure
                  error={error ?? new Error('Could not load newer messages.')}
                  retry={() => fetchNextPage({ cancelRefetch: false })}
                />
              ) : undefined
            }
            onJumpHandled={finishJump}
            jumpVersion={jumpVersion}
            messages={messages}
            search={{ term: normalizedSearch, active }}
            target={target}
            context={{
              compact: narrow,
              revealToolId: toolTarget,
              projectId,
              projectPath: project.data?.project.path,
              subagents: data.subagents,
              openSubagent: (id) => {
                setRequestedAgent({ id });
                setMobileTab('usage');
                requestAnimationFrame(() =>
                  document
                    .getElementById(`subagent-${encodeURIComponent(id)}`)
                    ?.scrollIntoView?.({ block: 'center' }),
                );
              },
              openChange: (id) => {
                setRequestedTool(id);
                setMobileTab('files');
              },
            }}
          />
          <Composer
            projectId={projectId}
            sessionId={sessionId}
            lastResponse={lastResponse}
            status={poll.data?.status ?? data.session.status}
            lastAt={poll.data?.lastAt ?? data.session.lastAt}
          />
        </div>
        <aside
          aria-label="Session rail"
          className="session-sidebar min-w-0 space-y-4"
          hidden={narrow && mobileTab === 'chat'}
        >
          {sidebar}
        </aside>
      </div>
      <nav aria-label="Session sections" className="session-bottom-nav">
        {(
          [
            ['chat', 'Chat', MessageSquare],
            ['outline', 'Outline', List],
            ['files', 'Files', Files],
            ['usage', 'Usage', ChartNoAxesColumn],
          ] as const
        ).map(([tab, label, Icon]) => (
          <button
            key={tab}
            aria-current={mobileTab === tab ? 'page' : undefined}
            onClick={() => switchTab(tab)}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {scrolledUp && (!narrow || mobileTab === 'chat') && (
        <button
          className="jump-latest"
          disabled={loadingLatest || isFetching}
          onClick={() => void jumpLatest()}
        >
          Jump to latest
        </button>
      )}
    </div>
  );
}
