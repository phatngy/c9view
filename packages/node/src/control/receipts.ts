import { createHash } from 'node:crypto';
import type { CommandReceipt } from '@c9view/api';
import { ControlError } from './errors.js';
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => `${JSON.stringify(key)}:${canonical(val)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
interface Reservation {
  fingerprint: string;
  promise: Promise<CommandReceipt>;
  receipt?: CommandReceipt;
  expires: number;
  settled?: boolean;
}
export class Receipts {
  private entries = new Map<string, Reservation>();
  private tombstones = new Set<string>();
  constructor(
    readonly bootId: string,
    private ttlMs: number,
    private cap: number,
    private now = Date.now,
  ) {}
  private sweep() {
    for (const [key, entry] of this.entries)
      if (entry.settled && entry.expires <= this.now()) {
        this.entries.delete(key);
        if (this.tombstones.size < this.cap) this.tombstones.add(key);
      }
  }
  get unavailable(): string | undefined {
    this.sweep();
    return this.tombstones.size >= this.cap
      ? 'restart the node to accept new commands'
      : undefined;
  }
  get(id: string) {
    this.sweep();
    const receipt = [...this.entries.values()].find(
      (entry) => entry.receipt?.clientRequestId === id,
    )?.receipt;
    return receipt ? structuredClone(receipt) : undefined;
  }
  update(operation: string, id: string, patch: Partial<CommandReceipt>) {
    const entry = this.entries.get(`${operation}:${id}`);
    if (entry?.receipt) Object.assign(entry.receipt, patch);
  }
  async run(
    operation: string,
    id: string,
    payload: unknown,
    clientBootId: string | undefined,
    action: () => Promise<Partial<CommandReceipt>>,
  ): Promise<CommandReceipt> {
    this.sweep();
    const key = `${operation}:${id}`;
    const fingerprint = createHash('sha256')
      .update(
        canonical(
          payload && typeof payload === 'object' && !Array.isArray(payload)
            ? Object.fromEntries(
                Object.entries(payload).filter(
                  ([key]) => key !== 'clientRequestId',
                ),
              )
            : payload,
        ),
      )
      .digest('hex');
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new ControlError(
          409,
          'Command payload changed',
          'payload-mismatch',
        );
      return structuredClone(await existing.promise);
    }
    if (
      clientBootId !== this.bootId ||
      this.tombstones.has(key) ||
      this.unavailable
    )
      throw new ControlError(
        409,
        'Unknown command outcome; refresh the machine before sending a new command',
        'unknown-outcome',
      );
    // Keep a rejected reservation too: retrying a failed validation must never act.
    const entry: Reservation = {
      fingerprint,
      expires: Infinity,
      promise: Promise.resolve().then(async () => {
        try {
          const result = await action();
          entry.receipt = {
            clientRequestId: id,
            bootId: this.bootId,
            operation,
            status: 'done',
            ...result,
          };
          return entry.receipt;
        } finally {
          entry.settled = true;
          entry.expires = this.now() + this.ttlMs;
        }
      }),
    };
    this.entries.set(key, entry);
    return structuredClone(await entry.promise);
  }
}
