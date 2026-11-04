import { Hono } from 'hono';
import type { DataStore } from '@c9view/node';

export function eventRoutes(store: DataStore) {
  const app = new Hono();
  app.get('/events', (c) => {
    if (store.events.listeners.size >= 32)
      return c.json({ error: 'Too many event clients' }, 503);
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>(
      {
        start(controller) {
          let finished = false;
          const send = (text: string) => {
            if (finished) return;
            const chunk = encoder.encode(text);
            if (chunk.byteLength > (controller.desiredSize ?? 0)) {
              cleanup();
              controller.close();
              return;
            }
            controller.enqueue(chunk);
          };
          const unsubscribe = store.events.subscribe(({ event, data }) =>
            send(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
          const heartbeat = setInterval(() => send(': heartbeat\n\n'), 15_000);
          heartbeat.unref();
          cleanup = () => {
            if (finished) return;
            finished = true;
            clearInterval(heartbeat);
            unsubscribe();
            c.req.raw.signal.removeEventListener('abort', abort);
          };
          const abort = () => {
            cleanup();
            controller.close();
          };
          c.req.raw.signal.addEventListener('abort', abort, { once: true });
          send('retry: 3000\n\n');
          if (c.req.raw.signal.aborted) abort();
        },
        cancel() {
          cleanup();
        },
      },
      { highWaterMark: 256 * 1024, size: (chunk) => chunk.byteLength },
    );
    return new Response(body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  });
  return app;
}
