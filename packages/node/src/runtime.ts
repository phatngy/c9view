import { DataStore, type ServerConfig } from './data/store.js';
import { startIndex } from './data/start-index.js';
import { createNodeHello } from './hello.js';

export type NodeRuntime = ReturnType<typeof createNode>;
export function createNode(
  config: ServerConfig,
  options: ConstructorParameters<typeof DataStore>[1] = {},
) {
  const store = new DataStore(config, options);
  let index: ReturnType<typeof startIndex> | undefined;
  let closeFlight: Promise<void> | undefined;
  let warm: Promise<void> | undefined;
  return {
    config,
    store,
    events: store.events,
    hello: createNodeHello(),
    start() {
      if (closeFlight) throw new Error('Node runtime is closed');
      if (!index) {
        warm = store.cache.warm(config.claudeDir).then(
          () => {},
          () => {
            /* Request-time reads retry warming failures. */
          },
        );
        index = startIndex(config, store);
      }
      return index;
    },
    close(): Promise<void> {
      return (closeFlight ??= Promise.resolve().then(async () => {
        if (index) await index.close();
        else store.hooks.close();
        await warm;
      }));
    },
  };
}
