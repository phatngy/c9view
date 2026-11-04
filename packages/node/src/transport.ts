import type { NodeHello, NodeSnapshot } from './hello.js';
import type { NodeRuntime } from './runtime.js';
import { loadNodeLimits, type NodeLimits } from './limits.js';
import { redactStrings } from './data/redaction.js';

export interface NodeRequest {
  method: 'GET' | 'POST';
  path: string;
  query: Record<string, string>;
  body?: Uint8Array;
}
export interface NodeResponse {
  status: number;
  contentType: string;
  body: AsyncIterable<Uint8Array>;
}
export type NodeEvent = { type: string; [k: string]: unknown };
export interface NodeTransport {
  readonly machineId: string;
  hello(): NodeHello;
  request(req: NodeRequest, signal: AbortSignal): Promise<NodeResponse>;
  subscribe(listener: (event: NodeEvent) => void): () => void;
  snapshot(): Promise<NodeSnapshot>;
  close(): void;
}
export interface NodeRequestApp {
  fetch(request: Request): Response | Promise<Response>;
}
function response(
  status: number,
  chunks: Uint8Array[],
  contentType = 'application/json',
): NodeResponse {
  return {
    status,
    contentType,
    body: (async function* () {
      yield* chunks;
    })(),
  };
}
function failure(status: number, error: string) {
  return response(status, [
    new TextEncoder().encode(JSON.stringify({ error })),
  ]);
}

export class InProcessTransport implements NodeTransport {
  readonly machineId = 'local';
  private openRequests = 0;
  private closed = false;
  private subscriptions = new Set<() => void>();
  constructor(
    private readonly runtime: Pick<NodeRuntime, 'store' | 'events' | 'hello'>,
    private readonly app: NodeRequestApp,
    private readonly limits: NodeLimits = loadNodeLimits(),
  ) {}
  hello(): NodeHello {
    return structuredClone(this.runtime.hello);
  }
  async request(req: NodeRequest, signal: AbortSignal): Promise<NodeResponse> {
    signal.throwIfAborted();
    if (this.closed) return this.error(503, 'Node transport closed');
    if ((req.body?.byteLength ?? 0) > this.limits.requestBodyMaxBytes)
      return this.error(413, 'Request body too large');
    if (this.openRequests >= this.limits.maxOpenRequests)
      return this.error(503, 'Too many open requests');
    // Envelopes contain node-relative paths, never URLs supplied by a browser.
    if (
      !req.path.startsWith('/') ||
      req.path.startsWith('//') ||
      req.path.includes('?') ||
      req.path.includes('#') ||
      req.path.includes('\\')
    )
      return this.error(404, 'Not found');
    this.openRequests++;
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let idle: ReturnType<typeof setTimeout> | undefined;
    let rejectStopped!: (reason: unknown) => void;
    const stopped = new Promise<never>((_, reject) => {
      rejectStopped = reject;
    });
    const timeout = new Error('Node request deadline exceeded');
    const stop = (reason: unknown) => {
      rejectStopped(reason);
      controller.abort(reason);
      void reader?.cancel().catch(() => {});
    };
    const abort = () => stop(signal.reason);
    const resetIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(() => stop(timeout), this.limits.requestIdleMs);
    };
    signal.addEventListener('abort', abort, { once: true });
    const total = setTimeout(
      () => stop(timeout),
      this.limits.requestDeadlineMs,
    );
    resetIdle();
    try {
      const url = new URL(`http://node.invalid${req.path}`);
      url.search = new URLSearchParams(req.query).toString();
      const request = new Request(url, {
        method: req.method,
        signal: controller.signal,
        ...(req.body
          ? {
              body: new Uint8Array(req.body),
              headers: { 'content-type': 'application/json' },
            }
          : {}),
      });
      const dispatched = Promise.resolve(this.app.fetch(request)).then(
        (result) => {
          if (controller.signal.aborted)
            void result.body?.cancel().catch(() => {});
          return result;
        },
      );
      const result = await Promise.race([dispatched, stopped]);
      reader = result.body?.getReader();
      const chunks: Uint8Array[] = [];
      // Finish before returning the envelope: HTTP status cannot change after
      // headers are relayed, so a deadline during body consumption must be known
      // here to preserve the contract's 504 status. Output remains byte-chunked.
      if (reader)
        for (;;) {
          const chunk = await Promise.race([reader.read(), stopped]);
          if (controller.signal.aborted) await stopped;
          if (chunk.done) break;
          if (chunk.value.byteLength) resetIdle();
          for (
            let offset = 0;
            offset < chunk.value.byteLength;
            offset += this.limits.responseChunkMaxBytes
          )
            chunks.push(
              chunk.value.slice(
                offset,
                offset + this.limits.responseChunkMaxBytes,
              ),
            );
        }
      return response(
        result.status,
        chunks,
        result.headers.get('content-type') ?? 'application/octet-stream',
      );
    } catch (error) {
      if (signal.aborted) signal.throwIfAborted();
      if (error === timeout) return this.error(504, 'Gateway timeout');
      throw error;
    } finally {
      clearTimeout(total);
      clearTimeout(idle);
      signal.removeEventListener('abort', abort);
      reader?.releaseLock();
      this.openRequests--;
    }
  }
  private error(status: number, message: string) {
    const result = failure(status, message);
    const max = this.limits.responseChunkMaxBytes;
    return {
      ...result,
      body: (async function* () {
        for await (const bytes of result.body)
          for (let offset = 0; offset < bytes.byteLength; offset += max)
            yield bytes.slice(offset, offset + max);
      })(),
    };
  }
  subscribe(listener: (event: NodeEvent) => void): () => void {
    if (this.closed) return () => {};
    // LiveEvent {event, data} -> NodeEvent {...data, type: event}.
    // The hub reverses this mapping to frame SSE; identity is hub-owned.
    const unsubscribe = this.runtime.events.subscribe((event) => {
      const data: Record<string, unknown> = { ...event.data };
      delete data.machineId;
      listener({ ...data, type: event.event });
    });
    const stop = () => {
      unsubscribe();
      this.subscriptions.delete(stop);
    };
    this.subscriptions.add(stop);
    return stop;
  }
  async snapshot(): Promise<NodeSnapshot> {
    const projects = await this.runtime.store.snapshot();
    return redactStrings({
      projects: projects.map((p) => p.project),
      sessions: projects.flatMap((p) => p.sessions),
      controlRuns: [],
    });
  }
  close(): void {
    this.closed = true;
    for (const unsubscribe of this.subscriptions) unsubscribe();
  }
}
