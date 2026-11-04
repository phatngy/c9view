import { randomUUID } from 'node:crypto';
import { VERSION } from '@c9view/core';
import type { ProjectSummary, SessionSummary } from '@c9view/api';

export interface NodeHello {
  bootId: string;
  version: string;
  protocol: 1;
  capabilities: { control: 'off' };
}
export interface NodeSnapshot {
  projects: ProjectSummary[];
  sessions: SessionSummary[];
  controlRuns: unknown[];
}
// Shared by runtimes in this process; a process restart creates a new identity.
const bootId = randomUUID();
export function createNodeHello(): NodeHello {
  return {
    bootId,
    version: VERSION,
    protocol: 1,
    capabilities: { control: 'off' },
  };
}
