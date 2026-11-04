# Contract: NodeTransport (hub ↔ node)

Owner: `packages/node/src/transport.ts` (6.0a). Implementations: `InProcessTransport` (6.0a) and the hub's WebSocket transport (`apps/hub/src/nodes/ws-transport.ts`, 7b). Both pass one shared contract test suite (`packages/node/src/transport.contract.ts`, run by each implementation's test file).

```ts
interface NodeRequest {
  method: 'GET' | 'POST';
  path: string; // node-relative, e.g. /projects/x/sessions/y
  query: Record<string, string>;
  body?: Uint8Array; // ≤ C9VIEW_REQUEST_BODY_MAX_BYTES encoded
}
interface NodeResponse {
  status: number;
  contentType: string;
  body: AsyncIterable<Uint8Array>; // chunks ≤ C9VIEW_RESPONSE_CHUNK_MAX_BYTES
}
type NodeEvent = { type: string; [k: string]: unknown }; // hint, IDs only, no machineId
interface NodeTransport {
  readonly machineId: string; // set by the hub; 'local' for the in-process node
  hello(): NodeHello;
  request(req: NodeRequest, signal: AbortSignal): Promise<NodeResponse>;
  subscribe(listener: (event: NodeEvent) => void): () => void;
  snapshot(): Promise<NodeSnapshot>;
  close(): void;
}
```

## Rules (FR-002, FR-005, FR-015, FR-016)

| Rule               | Expected                                                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Browser headers    | No `Cookie`, `Origin`, `Host`, `Authorization` or other browser header reaches the node; the envelope has no header field.       |
| Body too large     | 413 before the node sees it.                                                                                                     |
| Chunk size         | Every chunk ≤ chunk max; a larger body arrives whole across chunks.                                                              |
| Total deadline     | 504 after `C9VIEW_REQUEST_DEADLINE_MS`; node's `signal` aborted.                                                                 |
| Idle deadline      | 504 after `C9VIEW_REQUEST_IDLE_MS` without a chunk; node's `signal` aborted.                                                     |
| 504 meaning        | "hub stopped waiting", not "cancelled"; mutations recover via receipts (002 FR-021).                                             |
| Allowlist          | Every `GET` route of the node app; control routes only when the node's control flag is on; else 404.                             |
| Open requests      | > `C9VIEW_NODE_MAX_OPEN_REQUESTS` → 503 on the hub.                                                                              |
| Identity           | Responses and events carry no `machineId`; the hub stamps it in envelopes and overwrites any a node sends.                       |
| subscribe/snapshot | Events from the node runtime's `EventHub` reach the listener; `snapshot()` returns projects, sessions with status, control runs. |
