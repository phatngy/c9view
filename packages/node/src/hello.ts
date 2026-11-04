import { randomUUID } from 'node:crypto';
import { VERSION } from '@c9view/core';
import { hostname } from 'node:os';
import type { NodeHello } from '@c9view/api';
export type { NodeHello, NodeSnapshot } from '@c9view/api';

// Shared by runtimes in this process; a process restart creates a new identity.
const bootId = randomUUID();
export function createNodeHello(): NodeHello {
  return {
    name: hostname(),
    bootId,
    version: VERSION,
    protocol: 1,
    capabilities: { control: { state: 'off' }, bypass: false },
  };
}
