import { expect, it } from 'vitest';
import { machineEventSchema, machineStateEventSchema } from './events.js';

it('accepts open-ended node hints and unknown machine event fields', () => {
  expect(
    machineEventSchema.parse({
      machineId: 'remote',
      extra: true,
      event: { type: 'future', arbitrary: 42 },
    }),
  ).toEqual({ machineId: 'remote', event: { type: 'future', arbitrary: 42 } });
  expect(
    machineStateEventSchema.parse({
      type: 'machine',
      machineId: 'remote',
      state: 'offline',
      future: true,
    }),
  ).toEqual({ type: 'machine', machineId: 'remote', state: 'offline' });
});

it.each([
  {},
  { machineId: 'local', event: null },
  { machineId: 'local', event: { type: 42 } },
])('rejects malformed node envelope %j', (data) => {
  expect(machineEventSchema.safeParse(data).success).toBe(false);
});
