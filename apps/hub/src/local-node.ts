import {
  createNodeApp,
  InProcessTransport,
  type NodeRuntime,
  type NodeLimits,
} from '@c9view/node';

/** Create the local node transport with errors visible to the hub handler. */
export function createLocalTransport(
  runtime: Pick<NodeRuntime, 'store' | 'events' | 'hello'>,
  limits?: NodeLimits,
) {
  const nodeApp = createNodeApp(runtime, limits).onError((error) => {
    // Let the hub log the browser-facing path and sanitize the response.
    throw error;
  });
  return new InProcessTransport(runtime, nodeApp, limits);
}
