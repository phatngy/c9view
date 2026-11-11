import { BypassBadge, DrivenBadge } from '../../control/cards.js';
import { SessionLabel, SessionTitle } from '../../control/SessionLabel.js';
import { useState } from 'react';
import type {
  RunSummary,
  SessionDetailResponse,
  SessionStatus,
} from '@c9view/api';
import { GitBranch, Search, Info } from 'lucide-react';
import { Badge } from '../../kit/Badge.js';
import { IconButton } from '../../kit/IconButton.js';
import { Tooltip } from '../../kit/Tooltip.js';
import { labels, money, number, relative, total } from '../../ui.js';
import { modelLabel } from '../../kit/model.js';
import { contextUsage } from '../context.js';
import { ExportMenu } from '../ExportMenu.js';
import { MoreMenu } from './MoreMenu.js';

const chip =
  'inline-flex h-6 items-center gap-1.5 whitespace-nowrap [overflow-wrap:normal] rounded-md border border-line px-2 text-xs';
const billingNote =
  'Estimated at API list prices; not your actual bill on a subscription plan.';

export function SessionHeader({
  data,
  projectName,
  status,
  projectId,
  sessionId,
  usage,
  searchOpen,
  toggleSearch,
  searchButton,
  notice,
  ownedRun,
}: {
  ownedRun?: RunSummary | undefined;
  data: SessionDetailResponse;
  projectName: string;
  status: SessionStatus;
  projectId: string;
  sessionId: string;
  usage: ReturnType<typeof contextUsage>;
  searchOpen: boolean;
  toggleSearch: () => void;
  searchButton: (button: HTMLButtonElement | null) => void;
  notice: (message: string) => void;
}) {
  const { session } = data;
  const controlBadges = ownedRun && (
    <>
      <DrivenBadge compact />
      {ownedRun.mode === 'bypassPermissions' && <BypassBadge compact />}
    </>
  );
  const [details, setDetails] = useState(false);
  const primaryModel =
    [...data.byModel].sort((a, b) => b.costUsd - a.costUsd)[0]?.model ??
    session.models.at(-1);
  const models = [
    ...new Set([
      ...session.models,
      ...data.byModel.map((entry) => entry.model),
    ]),
  ];
  return (
    <header
      data-details-open={details || undefined}
      className="session-header sticky top-0 z-2 flex flex-none flex-wrap items-center border-b border-line bg-page md:static"
    >
      <div className="compact-session-header">
        {controlBadges}
        <div className="min-w-0 flex-1">
          <p className="truncate text-lead font-semibold">
            <SessionTitle
              projectId={projectId}
              sessionId={sessionId}
              title={session.title}
            />
          </p>
          <p className="truncate text-xs text-muted">
            {projectName} ·{' '}
            {primaryModel ? modelLabel(primaryModel) : 'Unknown model'} · ctx{' '}
            {Math.round(usage.percent)}%
          </p>
        </div>
        <IconButton
          label="Search this session"
          icon={Search}
          variant="default"
          aria-expanded={searchOpen}
          aria-controls="session-search"
          onClick={(event) => {
            searchButton(event.currentTarget);
            toggleSearch();
          }}
          className="compact-session-search min-h-11"
        />
        <IconButton
          label="Session details"
          icon={Info}
          aria-expanded={details}
          aria-controls="session-full-header"
          onClick={() => setDetails(!details)}
        />
      </div>
      <div id="session-full-header" className="session-desktop-header">
        <div className="session-header-primary">
          <div className="session-header-status">
            {controlBadges}
            <Badge status={status.column}>{labels[status.column]}</Badge>
            <span className="text-xs text-muted">{status.reason}</span>
            {status.observedAt && (
              <span className="text-xs text-muted">
                · {relative(status.observedAt)}
              </span>
            )}
            {status.stale && <Badge>stale</Badge>}
          </div>
          <h1
            className="session-header-title text-2xl font-semibold tracking-[-.01em]"
            tabIndex={-1}
          >
            <SessionTitle
              projectId={projectId}
              sessionId={sessionId}
              title={session.title}
            />
          </h1>
          <div className="session-header-actions">
            <IconButton
              label="Search this session"
              icon={Search}
              variant="default"
              aria-expanded={searchOpen}
              aria-controls="session-search"
              onClick={(event) => {
                searchButton(event.currentTarget);
                toggleSearch();
              }}
              className="session-desktop-search max-sm:min-h-11"
            />
            <SessionLabel projectId={projectId} sessionId={sessionId} />
            <MoreMenu sessionId={sessionId} cwd={data.cwd} notice={notice} />
            <ExportMenu projectId={projectId} sessionId={sessionId} />
          </div>
        </div>
        <div className="session-header-secondary">
          <div className="session-header-chips">
            {primaryModel && (
              <Badge model={primaryModel} className="h-6 border-line">
                {modelLabel(primaryModel)}
                {models.length > 1 && (
                  <Tooltip content={models.map(modelLabel).join(', ')}>
                    <span
                      className="text-muted"
                      tabIndex={0}
                      aria-label={`${models.length - 1} more models: ${models
                        .filter((model) => model !== primaryModel)
                        .map(modelLabel)
                        .join(', ')}`}
                    >
                      +{models.length - 1}
                    </span>
                  </Tooltip>
                )}
              </Badge>
            )}
            {session.gitBranch && (
              <span className={`${chip} font-mono text-small`}>
                <GitBranch size={12} aria-hidden="true" />
                {session.gitBranch}
              </span>
            )}
            <span className={chip}>
              {data.totalMessages.toLocaleString()} messages
            </span>
            <span className={chip}>{number(total(session.tokens))} tokens</span>
            <Tooltip content={billingNote}>
              <a
                href="#api-equivalent-cost"
                className={`${chip} focus-visible:outline-2 focus-visible:outline-accent max-sm:min-h-11`}
              >
                ≈ {money(session.costUsd)} API-equivalent
                <span className="sr-only">
                  {' '}
                  approximate API-equivalent cost
                </span>
              </a>
            </Tooltip>
          </div>
          <div className="session-header-context">
            <div
              className="compact-context-bar"
              role="img"
              aria-label={`Context window ${Math.round(usage.percent)} percent full`}
            >
              <span
                style={{
                  width: `${Math.min(100, Math.max(0, usage.percent))}%`,
                }}
              />
            </div>
            <span>
              ctx {Math.round(usage.percent)}% · {number(usage.used)}/
              {number(usage.capacity)}
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
