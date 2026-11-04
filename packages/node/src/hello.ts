import { randomUUID } from 'node:crypto';
import { VERSION } from '@c9view/core';
import { hostname } from 'node:os';
import type { NodeHello, ControlCapability } from '@c9view/api';
export type { NodeHello, NodeSnapshot } from '@c9view/api';

// Shared by runtimes in this process; a process restart creates a new identity.
const bootId = randomUUID();
export function createNodeHello(control?: {
  readonly capability: ControlCapability;
  readonly claudeCodeVersion?: string;
}): NodeHello {
  const hello: NodeHello = {
    name: hostname(),
    bootId,
    version: VERSION,
    protocol: 1,
    capabilities: { control: { state: 'off' }, bypass: false },
  };
  if (control) {
    if (control.claudeCodeVersion)
      hello.claudeCodeVersion = control.claudeCodeVersion;
    Object.defineProperty(hello.capabilities, 'control', {
      enumerable: true,
      get: () => {
        const { state, reason } = control.capability;
        return { state, ...(reason ? { reason } : {}) };
      },
    });
    Object.defineProperty(hello.capabilities, 'bypass', {
      enumerable: true,
      get: () => control.capability.bypass,
    });
  }
  return hello;
}
