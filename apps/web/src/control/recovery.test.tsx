import type { ControlRuns } from '@c9view/api';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { MachineContext } from '../machine.js';
import { queryKeys } from '../queryKeys.js';
import { Composer } from './Composer.js';
import { controlApi, ControlError } from './api.js';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const receipt = {
  clientRequestId: 'command',
  bootId: 'boot',
  operation: 'decide',
  status: 'done',
};
const snapshot: ControlRuns = {
  runs: [
    {
      runId: 'r',
      projectId: 'p',
      sessionId: 's',
      state: 'waiting',
      mode: 'default',
      queued: 0,
      startedAt: '2026-11-01',
      ownedByC9view: true,
    },
  ],
  requests: ['first', 'second'].map((requestId) => ({
    requestId,
    runId: 'r',
    sessionId: 's',
    kind: 'permission',
    toolName: requestId,
    summary: 'Fixture request',
    createdAt: '2026-11-01',
    expiresAt: '2026-12-01',
  })),
};
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status });
}
async function tick(ms = 10) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function mount(
  read: () => Response | Promise<Response>,
  cards = false,
  post?: (url: string) => Response,
) {
  vi.useFakeTimers();
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/machines')
      return json([
        {
          machineId: 'fixture',
          bootId: 'boot',
          capabilities: { control: { state: 'ready' }, bypass: false },
        },
      ]);
    if (url.endsWith('/control/runs'))
      return json(cards ? snapshot : { runs: [], requests: [] });
    if (init?.method === 'POST')
      return post?.(url) ?? json({ error: 'Unavailable' }, 503);
    return read();
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  clients.push(client);
  client.setQueryData(queryKeys.machines(), [
    {
      machineId: 'fixture',
      bootId: 'boot',
      capabilities: { control: { state: 'ready' }, bypass: false },
    },
  ]);
  const view = render(
    <QueryClientProvider client={client}>
      <MachineContext value="fixture">
        <Composer projectId="p" sessionId="s" />
      </MachineContext>
    </QueryClientProvider>,
  );
  await tick();
  return { ...view, fetcher, client };
}
function reply() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Reply to session' }), {
    target: { value: 'Fixture reply' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

it.each([503, 504, 408, 'network'] as const)(
  'treats %s as uncertain without replaying POST',
  async (status) => {
    const fetcher = vi.fn(async () => {
      if (status === 'network') throw new TypeError('Network unavailable');
      return json({}, status);
    });
    vi.stubGlobal('fetch', fetcher);
    await expect(controlApi('fixture', 'boot').stop('r')).rejects.toMatchObject<
      Partial<ControlError>
    >({ kind: 'uncertain' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it('backs off receipt reads at 1, 2, 4, 8, then 10 seconds and caps waiting at two minutes', async () => {
  const times: number[] = [];
  const { fetcher } = await mount(() => {
    times.push(Date.now());
    return json({}, 503);
  });
  reply();
  await tick();
  await tick(31_000);
  expect(times.slice(1).map((time, index) => time - times[index]!)).toEqual([
    1000, 2000, 4000, 8000, 10000,
  ]);
  expect(screen.getByText('31s elapsed')).toBeVisible();
  await tick(89_000);
  expect(screen.queryByRole('button', { name: 'Stop waiting' })).toBeNull();
  expect(screen.getByText(/This may have been sent/)).toBeVisible();
  expect(screen.getByRole('textbox')).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  const reads = times.length;
  await tick(20_000);
  expect(times).toHaveLength(reads);
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1);
});

it('Stop waiting unlocks the card and ignores a late receipt without reposting', async () => {
  let finish!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const { fetcher } = await mount(() => pending, true);
  const allow = screen.getAllByRole('button', { name: 'Allow' })[0]!;
  fireEvent.click(allow);
  await tick();
  expect(allow).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
  await tick();
  expect(allow).toBeEnabled();
  expect(
    screen.getByRole('combobox', { name: 'Permission mode' }),
  ).toBeEnabled();
  expect(
    screen.getByRole('region', { name: 'Permission for first' }),
  ).toHaveFocus();
  finish(json(receipt));
  await tick();
  expect(screen.queryByText('Command received.')).toBeNull();
  expect(screen.getAllByText(/This may have been sent/).length).toBeGreaterThan(
    0,
  );
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1);
});

it('caps an uncertain card action and releases its pending promise', async () => {
  await mount(() => new Promise<Response>(() => {}), true);
  const allow = screen.getAllByRole('button', { name: 'Allow' })[0]!;
  fireEvent.click(allow);
  await tick();
  await tick(120_000);
  expect(allow).toBeEnabled();
  expect(screen.queryByText('Sending decision…')).toBeNull();
});

it('settles recovery on unmount and does not replay after a late receipt', async () => {
  let finish!: (response: Response) => void;
  const { unmount, fetcher } = await mount(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
    true,
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Allow' })[0]!);
  await tick();
  unmount();
  finish(json(receipt));
  await tick(130_000);
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1);
});

it('continues receipt recovery when the node returns', async () => {
  let online = false;
  const { fetcher } = await mount(() =>
    online
      ? json({ ...receipt, operation: 'reply' })
      : Promise.reject(new TypeError('offline')),
  );
  reply();
  await tick();
  await tick(1000);
  online = true;
  await tick(2000);
  expect(screen.getByText('Queued')).toBeVisible();
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(1);
});

it('focuses the next card after the focused card disappears and the composer after the last', async () => {
  const { client } = await mount(() => json(receipt), true);
  const allow = screen.getAllByRole('button', { name: 'Allow' })[0]!;
  allow.focus();
  await act(async () => {
    client.setQueryData(queryKeys.controlRuns('fixture'), {
      ...snapshot,
      requests: snapshot.requests.slice(1),
    });
  });
  await tick();
  expect(
    screen.getByRole('region', { name: 'Permission for second' }),
  ).toHaveFocus();
  await act(async () => {
    client.setQueryData(queryKeys.controlRuns('fixture'), {
      ...snapshot,
      requests: [],
    });
  });
  await tick();
  expect(screen.getByRole('textbox')).toHaveFocus();
});

it('keeps draft focus during a background request removal', async () => {
  const { client } = await mount(() => json(receipt), true);
  screen.getByRole('textbox').focus();
  await act(async () => {
    client.setQueryData(queryKeys.controlRuns('fixture'), {
      ...snapshot,
      requests: snapshot.requests.slice(1),
    });
  });
  await tick();
  expect(screen.getByRole('textbox')).toHaveFocus();
});

it.each([false, true])(
  'focuses the composer after a clean reply failure (cards: %s)',
  async (cards) => {
    await mount(
      () => json(receipt),
      cards,
      () => json({ error: 'Clean refusal' }, 400),
    );
    reply();
    await tick();
    expect(screen.getByText('Clean refusal')).toBeVisible();
    expect(
      screen.getByRole('textbox', { name: 'Reply to session' }),
    ).toHaveFocus();
  },
);

it('Stop waiting on uncertain trust unlocks the draft and never retries its refused reply', async () => {
  const trust = {
    path: '/fixture/project',
    fingerprint: 'fixture',
    hooks: [],
    mcpServers: [],
    allowRules: [],
    plugins: [],
    hasClaudeMd: false,
  };
  const { fetcher } = await mount(
    () => new Promise<Response>(() => {}),
    false,
    (url) =>
      url.endsWith('/projects/trust')
        ? json({}, 503)
        : json(
            { error: 'Trust required', reason: 'untrusted-folder', trust },
            409,
          ),
  );
  reply();
  await tick();
  fireEvent.click(screen.getByRole('button', { name: 'Trust this folder' }));
  await tick();
  fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
  await tick();
  expect(screen.getByRole('textbox')).toBeEnabled();
  expect(screen.getByRole('textbox')).toHaveValue('Fixture reply');
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(
    fetcher.mock.calls.filter(
      ([url, init]) => url.endsWith('/messages') && init?.method === 'POST',
    ),
  ).toHaveLength(1);
  expect(
    fetcher.mock.calls.filter(
      ([url, init]) =>
        url.endsWith('/projects/trust') && init?.method === 'POST',
    ),
  ).toHaveLength(1);
});

it('Stop waiting unlocks Fork and reply without replaying the uncertain fork', async () => {
  let posts = 0;
  const { fetcher } = await mount(
    () => new Promise<Response>(() => {}),
    false,
    () =>
      ++posts === 1
        ? json({ error: 'Held elsewhere', reason: 'live-elsewhere' }, 409)
        : json({}, 503),
  );
  reply();
  await tick();
  fireEvent.click(screen.getByRole('button', { name: 'Fork and reply' }));
  await tick();
  fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
  await tick();
  expect(screen.getByRole('button', { name: 'Fork and reply' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  expect(screen.getByRole('textbox')).toBeEnabled();
  expect(
    fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
  ).toHaveLength(2);
});

it('preserves a failed receipt error while unlocking its card', async () => {
  await mount(
    () =>
      json({ ...receipt, status: 'failed', error: 'Fixture command failed' }),
    true,
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'Allow' })[0]!);
  await tick();
  expect(screen.getAllByText('Fixture command failed').length).toBeGreaterThan(
    0,
  );
  expect(screen.getAllByRole('button', { name: 'Allow' })[0]).toBeEnabled();
});

it('does not move focus after a card loses focus to a nonfocusable area', async () => {
  const { client } = await mount(() => json(receipt), true);
  const allow = screen.getAllByRole('button', { name: 'Allow' })[0]!;
  allow.focus();
  allow.blur();
  await tick();
  expect(document.body).toHaveFocus();
  await act(async () => {
    client.setQueryData(queryKeys.controlRuns('fixture'), {
      ...snapshot,
      requests: snapshot.requests.slice(1),
    });
  });
  await tick();
  expect(document.body).toHaveFocus();
});

it.each(['remove', 'disable'] as const)(
  'preserves card focus through a browser null blur caused by %s',
  async (reason) => {
    const { client } = await mount(() => json(receipt), true);
    const allow = screen.getAllByRole('button', { name: 'Allow' })[0]!;
    allow.focus();
    await act(async () => {
      fireEvent.blur(allow, { relatedTarget: null });
      if (reason === 'disable') allow.closest('fieldset')!.disabled = true;
      else allow.remove();
      client.setQueryData(queryKeys.controlRuns('fixture'), {
        ...snapshot,
        requests: snapshot.requests.slice(1),
      });
    });
    await tick();
    expect(
      screen.getByRole('region', { name: 'Permission for second' }),
    ).toHaveFocus();
  },
);

it('does not let deferred blur clear a newly focused card', async () => {
  const { client } = await mount(() => json(receipt), true);
  const [first, second] = screen.getAllByRole('button', { name: 'Allow' });
  first!.focus();
  fireEvent.blur(first!, { relatedTarget: null });
  second!.focus();
  await tick();
  await act(async () => {
    client.setQueryData(queryKeys.controlRuns('fixture'), {
      ...snapshot,
      requests: snapshot.requests.slice(0, 1),
    });
  });
  await tick();
  expect(
    screen.getByRole('region', { name: 'Permission for first' }),
  ).toHaveFocus();
});

it('focuses the next card after a successful decision removes its card', async () => {
  const { client } = await mount(
    () => json(receipt),
    true,
    () => json(receipt),
  );
  const allow = screen.getAllByRole('button', { name: 'Allow' })[0]!;
  allow.focus();
  fireEvent.click(allow);
  await tick();
  expect(allow).toBeDisabled();
  fireEvent.blur(allow, { relatedTarget: null });
  await tick();
  await act(async () => {
    client.setQueryData(queryKeys.controlRuns('fixture'), {
      ...snapshot,
      requests: snapshot.requests.slice(1),
    });
  });
  await tick();
  expect(
    screen.getByRole('region', { name: 'Permission for second' }),
  ).toHaveFocus();
});

it('a failed reply with pending permissions keeps Enter away from a decision', async () => {
  const { fetcher } = await mount(
    () => json(receipt),
    true,
    () => json({ error: 'Reply refused' }, 400),
  );
  const composer = screen.getByRole('textbox', { name: 'Reply to session' });
  composer.focus();
  reply();
  await tick();
  expect(composer).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: 'Enter', code: 'Enter' });
  await tick();
  expect(
    fetcher.mock.calls.filter(
      ([url, init]) =>
        url.includes('/control/requests/') && init?.method === 'POST',
    ),
  ).toHaveLength(0);
});

it('keeps the live recovery status stable as the visual elapsed time advances', async () => {
  await mount(() => new Promise<Response>(() => {}));
  reply();
  await tick();
  const status = screen.getByText('Still checking whether it was sent…');
  expect(status).toHaveAttribute('role', 'status');
  const announcements: MutationRecord[] = [];
  const observer = new MutationObserver((records) =>
    announcements.push(...records),
  );
  observer.observe(status, {
    childList: true,
    characterData: true,
    subtree: true,
  });
  await tick(5000);
  expect(status).toHaveTextContent('Still checking whether it was sent…');
  expect(screen.getByText('5s elapsed')).toHaveAttribute('aria-hidden', 'true');
  expect(announcements).toHaveLength(0);
  observer.disconnect();
});

it.each(['stop', 'deadline'] as const)(
  '%s refreshes machines and runs after unknown recovery',
  async (end) => {
    const { fetcher, client } = await mount(
      () => new Promise<Response>(() => {}),
    );
    const invalidation = vi.spyOn(client, 'invalidateQueries');
    reply();
    await tick();
    const runsBefore = fetcher.mock.calls.filter(([url]) =>
      url.endsWith('/control/runs'),
    ).length;
    if (end === 'stop')
      fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
    else await tick(120_000);
    await tick();
    expect(invalidation).toHaveBeenCalledWith({
      queryKey: queryKeys.machines(),
    });
    expect(invalidation).toHaveBeenCalledWith({
      queryKey: queryKeys.controlRuns('fixture'),
    });
    expect(
      fetcher.mock.calls.filter(([url]) => url.endsWith('/control/runs'))
        .length,
    ).toBeGreaterThan(runsBefore);
    expect(fetcher.mock.calls.some(([url]) => url === '/api/machines')).toBe(
      true,
    );
    expect(
      fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'),
    ).toHaveLength(1);
  },
);

it.each(['deadline', 'failed receipt', '404', 'late receipt'] as const)(
  'preserves typing in another permission card through %s',
  async (end) => {
    let finish!: (response: Response) => void;
    await mount(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
      true,
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Deny with a message' })[1]!,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Allow' })[0]!);
    await tick();
    const message = screen.getByRole('textbox', { name: 'Message to Claude' });
    message.focus();
    fireEvent.change(message, { target: { value: 'Still writing a reason' } });
    if (end === 'deadline') await tick(120_000);
    else if (end === 'late receipt') {
      fireEvent.click(screen.getByRole('button', { name: 'Stop waiting' }));
      await tick();
      finish(json(receipt));
    } else
      finish(
        end === '404'
          ? json({}, 404)
          : json({ ...receipt, status: 'failed', error: 'Refused' }),
      );
    await tick();
    expect(message).toHaveFocus();
    expect(message).toHaveValue('Still writing a reason');
  },
);

it('preserves focus outside session control through the recovery deadline', async () => {
  const { container } = await mount(() => new Promise<Response>(() => {}));
  const elsewhere = document.createElement('textarea');
  elsewhere.setAttribute('aria-label', 'Elsewhere draft');
  container.append(elsewhere);
  reply();
  await tick();
  elsewhere.focus();
  elsewhere.value = 'Keep writing';
  await tick(120_000);
  expect(elsewhere).toHaveFocus();
  expect(elsewhere).toHaveValue('Keep writing');
});
