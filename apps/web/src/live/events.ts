import { z } from 'zod';

// The hub owns machine IDs; node events carry an open-ended, typed hint.
export const machineEventSchema = z.object({
  machineId: z.string(),
  event: z.object({ type: z.string() }).catchall(z.unknown()),
});
export const machineStateEventSchema = z.object({
  type: z.literal('machine'),
  machineId: z.string(),
  state: z.enum(['online', 'offline']),
  bootId: z.string().optional(),
});
