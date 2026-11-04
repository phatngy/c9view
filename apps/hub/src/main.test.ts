import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createNode,
  createNodeHello,
  type NodeRuntime,
  type NodeTransport,
} from '@c9view/node';
import { Machines } from './machines.js';
import { startServer } from './main.js';

vi.mock('@c9view/node', async (original) => ({
  ...(await original<typeof import('@c9view/node')>()),
  createNode: vi.fn(),
}));
vi.mock('./local-node.js', () => ({ createLocalTransport: () => null }));
const serve = vi.hoisted(() => vi.fn(() => new EventEmitter()));
vi.mock('@hono/node-server', () => ({ serve }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it.each(['127.0.0.1', 'localhost', '::1', '0.0.0.0', '192.0.2.1'])(
  'refuses control without login on %s, even with the insecure override',
  (host) => {
    for (const insecure of ['0', '1']) {
      vi.stubEnv('C9VIEW_INSECURE_NO_AUTH', insecure);
      expect(() => startServer({ host, auth: 'none', control: true })).toThrow(
        'Set C9VIEW_AUTH=token or --auth password',
      );
    }
    expect(createNode).not.toHaveBeenCalled();
    expect(serve).not.toHaveBeenCalled();
  },
);
it('refuses environment-enabled control before creating a node', () => {
  vi.stubEnv('C9VIEW_CONTROL', '1');
  expect(() => startServer({ auth: 'none' })).toThrow('including loopback');
  expect(createNode).not.toHaveBeenCalled();
});
function runtime(state: 'off' | 'ready' | 'unavailable', bypass = false) {
  const hello = createNodeHello();
  hello.capabilities = {
    control: {
      state,
      ...(state === 'unavailable'
        ? { reason: 'restart the node to accept new commands' }
        : {}),
    },
    bypass,
  };
  const fake = {
    hello,
    start: vi.fn(() => ({ ready: Promise.resolve() })),
    close: vi.fn(async () => {}),
  };
  vi.mocked(createNode).mockReturnValue(fake as unknown as NodeRuntime);
  return fake;
}
const options = {
  claudeDir: fileURLToPath(
    new URL('../../../tests/fixtures/claude', import.meta.url),
  ),
  webDist: fileURLToPath(new URL('../../web/dist', import.meta.url)),
};
it.each(['ready', 'unavailable'] as const)(
  'refuses a node reporting control %s before indexing or listening',
  (state) => {
    const fake = runtime(state);
    vi.stubEnv('C9VIEW_INSECURE_NO_AUTH', '1');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => startServer({ ...options, auth: 'none' })).toThrow(
      'A node reporting control requires login',
    );
    expect(fake.start).not.toHaveBeenCalled();
    expect(fake.close).toHaveBeenCalledOnce();
    expect(serve).not.toHaveBeenCalled();
    const transport: NodeTransport = {
      machineId: 'local',
      hello: () => fake.hello,
      request: vi.fn(),
      subscribe: () => () => {},
      snapshot: async () => ({ projects: [], sessions: [], control: [] }),
      close: () => {},
    };
    expect(() => new Machines(transport, 'none')).toThrow('C9VIEW_AUTH=token');
  },
);
it('passes explicit options to the node and warns every bypass startup', () => {
  vi.stubEnv('C9VIEW_TOKEN', 'synthetic-token-12345678901234567890');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  for (let i = 0; i < 2; i++) {
    runtime('ready', true);
    startServer({ ...options, auth: 'token', control: true, bypass: true });
    expect(createNode).toHaveBeenLastCalledWith(expect.anything(), {
      control: true,
      bypass: true,
    });
  }
  expect(warn).toHaveBeenCalledTimes(2);
  expect(warn).toHaveBeenCalledWith(
    expect.stringContaining('skips tool permission approvals'),
  );
});
it('preserves absent and explicit false options for node environment resolution', () => {
  runtime('off');
  startServer({ ...options, auth: 'none' });
  expect(createNode).toHaveBeenLastCalledWith(expect.anything(), {});
  vi.stubEnv('C9VIEW_CONTROL', '1');
  startServer({ ...options, auth: 'none', control: false, bypass: false });
  expect(createNode).toHaveBeenLastCalledWith(expect.anything(), {
    control: false,
    bypass: false,
  });
});
