import { Hono } from 'hono';
import type { MachineSummary } from '@c9view/api';
import type { AuthMode } from './auth/index.js';
import type { NodeTransport } from '@c9view/node';

export interface HubMachine {
  summary: MachineSummary;
  transport: NodeTransport | null;
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

  list(): MachineSummary[] {
    return Array.from(this.entries.values(), ({ summary }) => summary);
  }
}

export function machineRoutes(machines: Machines) {
  const app = new Hono();
  app.get('/machines', (c) => c.json(machines.list()));
  return app;
}
