import { afterEach, describe, expect, it } from 'vitest';
import type { NodeTransport, NodeEvent } from './transport.js';
import type { NodeLimits } from './limits.js';

/** Shared harness: remote implementations can bridge the supplied node handler. */
export interface TransportContractHarness {
  transport: NodeTransport;
  emit(event: NodeEvent): void;
  dispose(): void | Promise<void>;
}
export type TransportContractFactory = (
  handler: (request: Request) => Response | Promise<Response>,
  limits?: Partial<NodeLimits>,
) => TransportContractHarness | Promise<TransportContractHarness>;

export function describeTransportContract(
  name: string,
  factory: TransportContractFactory,
) {
  describe(`${name} transport contract`, () => {
    const cleanups: TransportContractHarness[] = [];
    async function setup(
      handler: Parameters<TransportContractFactory>[0],
      limits?: Partial<NodeLimits>,
    ) {
      const harness = await factory(handler, limits);
      cleanups.push(harness);
      return harness;
    }
    afterEach(async () => {
      for (const harness of cleanups.splice(0)) await harness.dispose();
    });
    const signal = () => new AbortController().signal;
    const get = { method: 'GET', path: '/probe', query: {} } as const;
    it('preserves method, path, query, body, status and content type without browser headers or identity', async () => {
      let seen: Request | undefined;
      const { transport } = await setup(async (request) => {
        seen = request;
        return new Response(await request.text(), {
          status: 201,
          headers: { 'content-type': 'text/plain' },
        });
      });
      const response = await transport.request(
        {
          method: 'POST',
          path: '/probe',
          query: { q: 'a & b' },
          body: new TextEncoder().encode('hello'),
          ...{
            headers: {
              Cookie: 'secret',
              Origin: 'https://browser.invalid',
              Host: 'browser.invalid',
              Authorization: 'secret',
              'X-Browser': 'secret',
            },
          },
        },
        signal(),
      );
      expect(response.status).toBe(201);
      expect(response.contentType).toBe('text/plain');
      expect(await bodyText(response.body)).toBe('hello');
      expect(seen!.method).toBe('POST');
      expect(new URL(seen!.url).pathname).toBe('/probe');
      expect(new URL(seen!.url).searchParams.get('q')).toBe('a & b');
      expect([...seen!.headers.keys()]).toEqual(['content-type']);
      expect(response).not.toHaveProperty('machineId');
      expect(transport.hello()).toMatchObject({
        protocol: 1,
        capabilities: { control: 'off' },
      });
      expect(transport.hello()).not.toHaveProperty('machineId');
      expect(transport.hello().bootId).toBe(transport.hello().bootId);
    });
    it('rejects oversized bodies before dispatch, accepts the boundary', async () => {
      let calls = 0;
      const { transport } = await setup(
        () => {
          calls++;
          return new Response('ok');
        },
        { requestBodyMaxBytes: 4 },
      );
      expect(
        (
          await transport.request(
            { ...get, method: 'POST', body: new Uint8Array(5) },
            signal(),
          )
        ).status,
      ).toBe(413);
      expect(calls).toBe(0);
      expect(
        (
          await transport.request(
            { ...get, method: 'POST', body: new Uint8Array(4) },
            signal(),
          )
        ).status,
      ).toBe(200);
      expect(calls).toBe(1);
    });
    it('re-chunks without changing bytes', async () => {
      const bytes = new TextEncoder().encode('😀large response😀');
      const { transport } = await setup(() => new Response(bytes), {
        responseChunkMaxBytes: 3,
      });
      const response = await transport.request(get, signal());
      const chunks = [];
      for await (const chunk of response.body) {
        expect(chunk.byteLength).toBeLessThanOrEqual(3);
        chunks.push(...chunk);
      }
      expect(new Uint8Array(chunks)).toEqual(bytes);
    });
    for (const kind of ['total', 'idle'] as const) {
      it(`${kind} deadline returns 504 and aborts the node signal, including during the body`, async () => {
        let seen: AbortSignal | undefined;
        const { transport } = await setup(
          (request) => {
            seen = request.signal;
            return new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(new Uint8Array([1]));
                },
              }),
            );
          },
          {
            requestDeadlineMs: kind === 'total' ? 25 : 200,
            requestIdleMs: kind === 'idle' ? 25 : 200,
          },
        );
        expect((await transport.request(get, signal())).status).toBe(504);
        expect(seen!.aborted).toBe(true);
      });
    }
    it('applies deadlines while waiting for response headers', async () => {
      let seen: AbortSignal | undefined;
      const { transport } = await setup(
        (request) => {
          seen = request.signal;
          return new Promise<Response>(() => {});
        },
        { requestDeadlineMs: 25, requestIdleMs: 200 },
      );
      expect((await transport.request(get, signal())).status).toBe(504);
      expect(seen!.aborted).toBe(true);
    });
    it('keeps the total deadline even while chunks keep arriving', async () => {
      let seen: AbortSignal | undefined;
      const { transport } = await setup(
        (request) => {
          seen = request.signal;
          let timer: ReturnType<typeof setInterval>;
          return new Response(
            new ReadableStream({
              start(controller) {
                timer = setInterval(
                  () => controller.enqueue(new Uint8Array([1])),
                  5,
                );
              },
              cancel() {
                clearInterval(timer);
              },
            }),
          );
        },
        { requestDeadlineMs: 40, requestIdleMs: 100 },
      );
      expect((await transport.request(get, signal())).status).toBe(504);
      expect(seen!.aborted).toBe(true);
    });
    it('preserves GET routes and the node app rejection of unavailable control routes', async () => {
      const { transport } = await setup((request) => {
        const path = new URL(request.url).pathname;
        return request.method === 'GET' && path === '/overview'
          ? Response.json({ value: 'node data' })
          : Response.json({ error: 'Not found' }, { status: 404 });
      });
      expect(
        (await transport.request({ ...get, path: '/overview' }, signal()))
          .status,
      ).toBe(200);
      for (const request of [
        get,
        { ...get, method: 'POST' as const, path: '/control' },
      ]) {
        const response = await transport.request(request, signal());
        expect(response.status).toBe(404);
        expect(await bodyText(response.body)).toBe(
          JSON.stringify({ error: 'Not found' }),
        );
      }
    });
    it('uses 504 to stop waiting without claiming the node operation was undone', async () => {
      let finish!: () => void;
      let completed = false;
      let seen: AbortSignal | undefined;
      const operation = new Promise<void>((resolve) => {
        finish = resolve;
      });
      const { transport } = await setup(
        async (request) => {
          seen = request.signal;
          // A mutation may finish despite an advisory abort. Future control
          // callers recover its outcome through receipts, never the 504 alone.
          await operation;
          completed = true;
          return Response.json({ completed });
        },
        { requestDeadlineMs: 25, requestIdleMs: 200 },
      );
      const result = await transport.request(
        { ...get, method: 'POST' },
        signal(),
      );
      expect(result.status).toBe(504);
      expect(seen!.aborted).toBe(true);
      expect(completed).toBe(false);
      finish();
      await operation;
      expect(completed).toBe(true);
    });
    it('aborts the node request when the caller aborts', async () => {
      let seen: AbortSignal | undefined;
      const { transport } = await setup((request) => {
        seen = request.signal;
        return new Promise<Response>(() => {});
      });
      const caller = new AbortController();
      const pending = transport.request(get, caller.signal);
      caller.abort();
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
      expect(seen!.aborted).toBe(true);
    });
    it('caps open requests and releases capacity after timeout', async () => {
      let calls = 0;
      const { transport } = await setup(
        () => {
          calls++;
          return new Promise<Response>(() => {});
        },
        { maxOpenRequests: 1, requestDeadlineMs: 25 },
      );
      const first = transport.request(get, signal());
      expect((await transport.request(get, signal())).status).toBe(503);
      expect(calls).toBe(1);
      expect((await first).status).toBe(504);
      expect((await transport.request(get, signal())).status).toBe(504);
      expect(calls).toBe(2);
    });
    it('forwards runtime hints, unsubscribes and closes subscriptions', async () => {
      const { transport, emit } = await setup(() => new Response());
      const events: NodeEvent[] = [];
      const unsubscribe = transport.subscribe((event) => events.push(event));
      emit({ type: 'session', projectId: 'p', sessionId: 's' });
      expect(events).toEqual([
        { type: 'session', projectId: 'p', sessionId: 's' },
      ]);
      expect(events[0]).not.toHaveProperty('machineId');
      unsubscribe();
      emit({ type: 'config' });
      expect(events).toHaveLength(1);
      transport.subscribe((event) => events.push(event));
      transport.close();
      transport.close();
      emit({ type: 'config' });
      expect(events).toHaveLength(1);
    });
    it('returns projects and sessions with status and empty control runs', async () => {
      const { transport } = await setup(() => new Response());
      const snapshot = await transport.snapshot();
      expect(snapshot.projects.length).toBeGreaterThan(0);
      expect(snapshot.sessions.length).toBeGreaterThan(0);
      expect(snapshot.sessions[0]).toHaveProperty('status.column');
      expect(snapshot.controlRuns).toEqual([]);
      expect(snapshot).not.toHaveProperty('machineId');
    });
  });
}
export async function bodyText(body: AsyncIterable<Uint8Array>) {
  const chunks: number[] = [];
  for await (const chunk of body) chunks.push(...chunk);
  return new TextDecoder().decode(new Uint8Array(chunks));
}
