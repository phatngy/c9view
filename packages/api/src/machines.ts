// Machine types shared by the hub, nodes and the web (001 data model).
// A machine is one node: 'local' is the hub's in-process node; remote nodes
// get a random UUID from the hub at pairing. Node payloads never carry a
// machineId; the hub stamps it.
import type { ProjectSummary, SessionSummary } from './index.js';

/** `'local'` for the hub's in-process node, else a hub-assigned UUID. Types only: this package ships as source. */
export type MachineId = string;

export type CapabilityState = 'off' | 'ready' | 'unavailable';

/** Advisory only: refreshed on every hello, the node rechecks on every call. */
export interface MachineCapabilities {
  control: { state: CapabilityState; reason?: string };
  bypass: boolean;
}

export interface MachineSummary {
  machineId: MachineId;
  name: string;
  /** `local` is always online. */
  state: 'online' | 'offline';
  lastSeenAt: string | null;
  version: string;
  protocol: number;
  claudeCodeVersion?: string;
  /** Set from 7c; false until then. */
  outdated: boolean;
  bootId: string;
  capabilities: MachineCapabilities;
}

/** Sent by a node when it connects. No machineId; bootId is random per node process. */
export interface NodeHello {
  name: string;
  version: string;
  protocol: number;
  claudeCodeVersion?: string;
  bootId: string;
  capabilities: MachineCapabilities;
}

/** A node's projects and sessions (with status). No machineId. */
export interface NodeSnapshot {
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  /** 002's run summaries; empty before session control. */
  control: unknown[];
}

/** A node's refresh hint: IDs only, never a machineId. */
export type NodeEvent = { type: string; [key: string]: unknown };

/** Hub-made SSE envelope for a node event. */
export interface MachineEvent {
  machineId: MachineId;
  event: NodeEvent;
}

/** Emitted by the hub when a machine connects (with bootId) or drops. */
export interface MachineStateEvent {
  type: 'machine';
  machineId: MachineId;
  state: 'online' | 'offline';
  bootId?: string;
}
