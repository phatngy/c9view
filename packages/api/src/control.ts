// Session control contract types (002 data model). Types only: this package
// ships as TypeScript source, so the node and hub enforce the limits below
// with their own Zod schemas. Node payloads never carry a machineId; the hub
// adds it in envelopes. Paths are relative to /api/m/:machineId.

/** Reported per machine; advisory only, the node rechecks on every call. */
export interface ControlCapability {
  state: 'off' | 'ready' | 'unavailable';
  bypass: boolean;
  reason?: string;
}

/** Browser-settable modes. `bypassPermissions` is never accepted in a body (400). */
export type PermissionMode = 'default' | 'acceptEdits' | 'plan';

/** A run's reported mode, which may be bypass when the node's flag is on. */
export type RunMode = PermissionMode | 'bypassPermissions';

export type RunState =
  'starting' | 'running' | 'waiting' | 'idle' | 'ended' | 'failed';

export interface RunSummary {
  runId: string;
  sessionId: string;
  projectId: string;
  state: RunState;
  mode: RunMode;
  /** Replies waiting for the current turn to finish. */
  queued: number;
  /** API-equivalent USD estimate from the SDK's total_cost_usd. */
  costUsd?: number;
  /** Redacted. */
  error?: string;
  startedAt: string;
  ownedByC9view: true;
}

export interface QuestionOption {
  label: string;
  description: string;
}

export interface ControlQuestion {
  question: string;
  header: string;
  /** 2–4 options. */
  options: QuestionOption[];
  multiSelect: boolean;
}

interface ControlRequestBase {
  requestId: string;
  runId: string;
  sessionId: string;
  createdAt: string;
  expiresAt: string;
}

export interface PermissionRequest extends ControlRequestBase {
  kind: 'permission';
  toolName: string;
  /** Redacted, in tool-row style. */
  summary: string;
}

export interface QuestionRequest extends ControlRequestBase {
  kind: 'question';
  questions: ControlQuestion[];
}

export type ControlRequest = PermissionRequest | QuestionRequest;

/** GET /control/runs */
export interface ControlRuns {
  runs: RunSummary[];
  requests: ControlRequest[];
}

/** POST /projects/:projectId/sessions/:sessionId/messages */
export interface ReplyBody {
  /** 1–20,000 characters. */
  text: string;
  /** UUID. */
  clientRequestId: string;
}

/** POST /projects/:projectId/sessions */
export interface NewSessionBody {
  /** 1–20,000 characters. */
  text: string;
  permissionMode?: PermissionMode;
  /** 1–80 characters. */
  name?: string;
  clientRequestId: string;
}

/** POST /projects (6d). */
export interface NewProjectBody {
  location: string;
  /** `https://`, `ssh://` or `user@host:path`. */
  gitUrl?: string;
  /** Defaults to true when there is no gitUrl. */
  gitInit?: boolean;
  text: string;
  /** Up to 80 characters. */
  name?: string;
  permissionMode?: PermissionMode;
  clientRequestId: string;
}

/** POST /control/requests/:requestId — exactly one decision shape. */
export type DecisionBody = { clientRequestId: string } & (
  | { decision: 'allow' }
  | {
      decision: 'deny';
      /** Up to 2,000 characters. */
      message?: string;
    }
  | {
      /** Keyed by question; each value an option label or "Other" text (≤ 2,000 characters). */
      answers: Record<string, string | string[]>;
    }
);

/** POST /control/runs/:runId/mode */
export interface ModeBody {
  mode: PermissionMode;
  clientRequestId: string;
}

/** POST /control/runs/:runId/interrupt and /stop */
export interface RunActionBody {
  clientRequestId: string;
}

/** What a folder's settings would let a session do; every field redacted. */
export interface TrustSummary {
  path: string;
  fingerprint: string;
  hooks: string[];
  mcpServers: string[];
  allowRules: string[];
  plugins: string[];
  hasClaudeMd: boolean;
}

/** POST /projects/trust */
export interface TrustBody {
  path: string;
  fingerprint: string;
  clientRequestId: string;
}

/** POST /projects/:projectId/sessions/:sessionId/label (6d). */
export interface LabelBody {
  /** 0–80 characters; empty removes the label. */
  label: string;
  clientRequestId: string;
}

export type ReceiptStatus =
  'accepted' | 'running' | 'done' | 'failed' | 'cloning' | 'ready';

/** GET /control/receipts/:clientRequestId, and every mutation's response. */
export interface CommandReceipt {
  clientRequestId: string;
  bootId: string;
  operation: string;
  status: ReceiptStatus;
  runId?: string;
  sessionId?: string;
  projectId?: string;
  /** Redacted. */
  error?: string;
  /** Set only for operation `remote`. */
  delivery?: RemoteDelivery;
}

export type ControlConflictReason =
  | 'live-elsewhere'
  | 'liveness-unknown'
  | 'payload-mismatch'
  | 'unknown-outcome'
  | 'untrusted-folder'
  | 'settings-changed'
  | 'decided'
  | 'run-exists'
  | 'remote-unavailable';

/** 409 body. */
export interface ControlConflict {
  error: string;
  reason: ControlConflictReason;
  trust?: TrustSummary;
  /** With `remote-unavailable`: the fresh check that refused the send. */
  availability?: RemoteAvailability;
}

/** 400 body. */
export interface ControlBadRequest {
  error: string;
  reason?:
    | 'outside-roots'
    | 'bad-url'
    | 'not-empty'
    | 'bypass-not-allowed'
    | 'bad-text';
}

/** Hints on the node's event hub, wrapped by the hub as MachineEvent. IDs only. */
export type ControlEvent =
  | { type: 'control.run'; runId: string; sessionId: string; projectId: string }
  | {
      type: 'control.request';
      requestId: string;
      runId: string;
      sessionId: string;
    }
  | { type: 'control.request.resolved'; requestId: string }
  | { type: 'control.project'; clientRequestId: string }
  | {
      type: 'control.remote';
      clientRequestId: string;
      projectId: string;
      sessionId: string;
    };

/** GET /workspace/roots (6d). 404 without roots or with control off. */
export interface WorkspaceRoots {
  roots: string[];
}

export interface WorkspaceEntry {
  name: string;
  path: string;
}

/** GET /workspace/browse?path=&hidden= (6d): one level of directories under the roots. */
export interface WorkspaceBrowse {
  /** Absent when listing the roots themselves. */
  path?: string;
  /** Absent at a root. */
  parent?: string;
  entries: WorkspaceEntry[];
  truncated: boolean;
}

export interface SessionLabelEntry {
  projectId: string;
  sessionId: string;
  label: string;
}

/** GET /labels (6d). */
export interface SessionLabels {
  labels: SessionLabelEntry[];
}

// Remote send to a session that is live in a terminal (003). Paths are relative
// to /api/m/:machineId. Nothing here carries a socket path, PID, version
// string, token or message text.

/** Why remote send is not offered. `own-run` and `not-live` mean "use 002's reply". */
export type RemoteUnavailableReason =
  | 'control-unavailable'
  | 'unsupported-platform'
  | 'own-run'
  | 'not-live'
  | 'liveness-unknown'
  | 'address-invalid'
  | 'not-interactive'
  | 'too-old'
  | 'unknown-protocol'
  | 'no-address'
  | 'token-required'
  | 'inbound-refused';

/** GET /projects/:projectId/sessions/:sessionId/remote */
export interface RemoteAvailability {
  sessionId: string;
  available: boolean;
  /** Set if and only if the session is not available. */
  reason?: RemoteUnavailableReason;
  /** With `too-old`. */
  minVersion?: string;
  /** Advisory warning on an available session; never blocks a send. */
  inbound?: 'hold' | 'may-hold';
  sessionState?: 'idle' | 'busy' | 'waiting' | 'unknown';
  /** ISO. */
  checkedAt: string;
}

/** POST /projects/:projectId/sessions/:sessionId/remote. Strict: unknown fields are 400. */
export interface RemoteSendBody {
  /** 1–20,000 characters; must not contain `cross-session-message` (case-insensitive). */
  text: string;
  /** UUID. */
  clientRequestId: string;
}

export type RemoteDeliveryState =
  'sent' | 'delivered' | 'not-seen' | 'uncertain' | 'failed';

export interface RemoteDelivery {
  state: RemoteDeliveryState;
  /** Only with `delivered`. */
  turn?: 'new-turn' | 'next-step';
  /** Only with `failed`. */
  reason?: 'session-ended' | 'unreachable';
  /** ISO. */
  sentAt?: string;
  /** ISO; the transcript record's own timestamp. */
  deliveredAt?: string;
}
