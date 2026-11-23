import { Hono } from 'hono';
import type { MachineSummary, NodeSnapshot } from '@c9view/api';
import type { AuthMode } from './auth/index.js';
import type { NodeTransport } from '@c9view/node';

export interface HubMachine {
  summary: MachineSummary;
  transport: NodeTransport | null;
  /**
   * Last projects and sessions seen while the machine was online. Merged
   * endpoints use it only when the machine is offline (R19); pairing (7b)
   * fills it, nothing else reads it.
   */
  snapshot?: NodeSnapshot | null;
}

/** Hub-owned directory; until pairing arrives its only entry is local. */
export class Machines {
  private readonly entries = new Map<string, HubMachine>();

  constructor(local: NodeTransport | null, authMode: AuthMode = 'none') {
    if (local) {
      const hello = local.hello();
      if (authMode === 'none' && hello.capabilities.control.state !== 'off')
        throw new Error(
          'A node reporting control requires login. Set C9VIEW_AUTH=token or --auth password; C9VIEW_INSECURE_NO_AUTH cannot override this.',
        );
      this.entries.set('local', {
        summary: {
          ...hello,
          machineId: 'local',
          state: 'online',
          lastSeenAt: null,
          outdated: false,
        },
        transport: local,
      });
    }
  }

  get(machineId: string): HubMachine | undefined {
    return this.entries.get(machineId);
  }

  /** Register a machine (pairing, 7b). Replaces an entry with the same id. */
  add(machine: HubMachine): void {
    this.entries.set(machine.summary.machineId, machine);
  }

  /** Remember the machine's latest snapshot for use while it is offline. */
  setSnapshot(machineId: string, snapshot: NodeSnapshot | null): void {
    const entry = this.entries.get(machineId);
    if (entry) entry.snapshot = snapshot;
  }

  entriesList(): HubMachine[] {
    return Array.from(this.entries.values());
  }

  list(): MachineSummary[] {
    return Array.from(this.entries.values(), ({ summary }) => summary);
  }
}

export function machineRoutes(machines: Machines) {
  const app = new Hono();
  app.get('/machines', (c) => c.json(machines.list()));
  return app;
}
