import { Hono } from 'hono';
import type { MachineEvent, MachineStateEvent } from '@c9view/api';
import type { NodeTransport } from '@c9view/node';

export function eventRoutes(transport: NodeTransport | null) {
  const app = new Hono();
  let clients = 0;
  app.get('/events', (c) => {
    if (clients >= 32) return c.json({ error: 'Too many event clients' }, 503);
    clients++;
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
          const unsubscribe =
            transport?.subscribe((event) => {
              const payload: MachineEvent = {
                machineId: 'local',
                event: {
                  ...event,
                  ...('machineId' in event ? { machineId: 'local' } : {}),
                },
              };
              send(
                `event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`,
              );
            }) ?? (() => {});
          const heartbeat = setInterval(() => send(': heartbeat\n\n'), 15_000);
          heartbeat.unref();
          cleanup = () => {
            if (finished) return;
            finished = true;
            clients--;
            clearInterval(heartbeat);
            clearTimeout(announcement);
            unsubscribe();
            c.req.raw.signal.removeEventListener('abort', abort);
          };
          const abort = () => {
            cleanup();
            controller.close();
          };
          c.req.raw.signal.addEventListener('abort', abort, { once: true });
          send('retry: 3000\n\n');
          // Keep the first retry frame byte-identical for existing SSE clients.
          // Let the HTTP adapter flush retry before announcing the machine.
          const announcement = setTimeout(() => {
            if (!transport) return;
            const event: MachineStateEvent = {
              type: 'machine',
              machineId: 'local',
              state: 'online',
              bootId: transport.hello().bootId,
            };
            send(`event: machine\ndata: ${JSON.stringify(event)}\n\n`);
          }, 100);
          announcement.unref();
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
