import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { redactText } from '@c9view/core';
import type { ControlEvent, RunMode, RunSummary } from '@c9view/api';
import type { Runner, RunnerOptions, SdkAdapter, UserInput } from './sdk.js';
import { Queue } from './queue.js';
import { ControlError } from './errors.js';
const messageSchema = z
  .object({
    type: z.string(),
    subtype: z.string().optional(),
    session_id: z.string().optional(),
    total_cost_usd: z.number().finite().nonnegative().optional(),
    is_error: z.boolean().optional(),
  })
  .passthrough();

export type CommandUpdate = (patch: {
  sessionId?: string;
  status?: 'running' | 'done' | 'failed';
  error?: string;
}) => void;
export interface ManagedRun {
  summary: RunSummary;
  queue: Queue<UserInput>;
  abort: AbortController;
  runner?: Runner;
  ready: Promise<void>;
  idle?: ReturnType<typeof setTimeout>;
  closed: boolean;
  interrupted: boolean;
  startTimer?: ReturnType<typeof setTimeout>;
  pending: number;
  updates: CommandUpdate[];
}
export class Runs {
  private runs = new Map<string, ManagedRun>();
  private closed = false;
  constructor(
    private maxRuns: number,
    private idleMs: number,
    private adapter: SdkAdapter,
    private emit: (event: ControlEvent) => void,
    private resolved: (runId: string) => void,
  ) {}
  snapshot() {
    return structuredClone([...this.runs.values()].map((run) => run.summary));
  }
  bySession(projectId: string, sessionId: string) {
    return [...this.runs.values()].find(
      (run) =>
        !run.closed &&
        run.summary.projectId === projectId &&
        run.summary.sessionId === sessionId,
    );
  }
  get(id: string) {
    const run = this.runs.get(id);
    if (!run || run.closed) throw new ControlError(404, 'Run not found');
    return run;
  }
  emitRun(run: ManagedRun) {
    const { runId, sessionId, projectId } = run.summary;
    this.emit({ type: 'control.run', runId, sessionId, projectId });
  }
  waiting(id: string, waiting: boolean) {
    const run = this.runs.get(id);
    if (run && !run.closed) {
      run.summary.state = waiting ? 'waiting' : 'running';
      this.emitRun(run);
    }
  }
  enqueue(run: ManagedRun, text: string, update: CommandUpdate = () => {}) {
    if (run.closed) throw new ControlError(409, 'Run closed', 'run-exists');
    clearTimeout(run.idle);
    run.pending++;
    run.updates.push(update);
    run.summary.queued = Math.max(0, run.pending - 1);
    if (run.summary.state === 'idle') run.summary.state = 'running';
    run.queue.push({
      type: 'user',
      message: { role: 'user', content: text },
      parent_tool_use_id: null,
      session_id: run.summary.sessionId,
    });
    this.emitRun(run);
  }
  create(projectId: string, sessionId: string, mode: RunMode): ManagedRun {
    if (this.closed) throw new ControlError(503, 'Control is closed');
    if (this.bySession(projectId, sessionId))
      throw new ControlError(409, 'Run exists', 'run-exists');
    if ([...this.runs.values()].filter((r) => !r.closed).length >= this.maxRuns)
      throw new ControlError(429, 'Too many active runs');
    // Finished summaries are hints, not history; bound them independently of active runs.
    if (this.runs.size >= this.maxRuns * 4)
      for (const [id, run] of this.runs)
        if (run.closed) {
          this.runs.delete(id);
          break;
        }
    const run: ManagedRun = {
      summary: {
        runId: randomUUID(),
        sessionId,
        projectId,
        state: 'starting',
        mode,
        queued: 0,
        startedAt: new Date().toISOString(),
        ownedByC9view: true,
      },
      queue: new Queue(),
      abort: new AbortController(),
      ready: Promise.resolve(),
      closed: false,
      interrupted: false,
      pending: 0,
      updates: [],
    };
    this.runs.set(run.summary.runId, run);
    this.emitRun(run);
    return run;
  }
  launch(
    run: ManagedRun,
    prepare: () => Promise<RunnerOptions>,
    update: (patch: {
      sessionId?: string;
      status?: 'running' | 'done' | 'failed';
      error?: string;
    }) => void,
  ) {
    // C9VIEW_CONTROL_IDLE_MIN also bounds startup before the SDK emits init.
    run.startTimer = setTimeout(() => {
      this.fail(
        run,
        new Error('Claude Code did not start before the timeout'),
        update,
      );
    }, this.idleMs);
    run.startTimer.unref();
    run.ready = (async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (run.closed) return;
      try {
        const options = await prepare();
        if (run.closed) return;
        const runner = await this.adapter(run.queue, options);
        run.runner = runner;
        if (run.closed) {
          runner.close();
          return;
        }
        void (async () => {
          try {
            for await (const raw of runner) {
              const parsed = messageSchema.safeParse(raw);
              if (!parsed.success) continue;
              const message = parsed.data;
              if (run.closed) break;
              if (
                message.type === 'system' &&
                message.subtype === 'init' &&
                message.session_id
              ) {
                clearTimeout(run.startTimer);
                run.summary.sessionId = message.session_id;
                run.summary.state = 'running';
                update({ sessionId: message.session_id, status: 'running' });
                for (const notify of run.updates)
                  notify({ sessionId: message.session_id });
                run.updates[0]?.({ status: 'running' });
              }
              if (message.type === 'result') {
                if (
                  typeof message.total_cost_usd === 'number' &&
                  Number.isFinite(message.total_cost_usd)
                )
                  run.summary.costUsd = message.total_cost_usd;
                run.pending = Math.max(0, run.pending - 1);
                run.summary.queued = Math.max(0, run.pending - 1);
                if (message.is_error && !run.interrupted) {
                  this.fail(run, 'Claude Code turn failed', update);
                  break;
                }
                run.interrupted = false;
                run.summary.state = run.pending ? 'running' : 'idle';
                update({ status: 'done' });
                run.updates.shift()?.({ status: 'done' });
                run.updates[0]?.({ status: 'running' });
                if (!run.pending) {
                  run.idle = setTimeout(() => this.stop(run), this.idleMs);
                  run.idle.unref();
                }
              }
              this.emitRun(run);
            }
            if (!run.closed) {
              if (run.pending)
                this.fail(
                  run,
                  'Claude Code ended before the turn completed',
                  update,
                );
              else this.stop(run);
            }
          } catch (error) {
            this.fail(run, error, update);
          }
        })();
      } catch (error) {
        this.fail(run, error, update);
      }
    })();
  }
  async interrupt(run: ManagedRun) {
    run.interrupted = run.pending > 0;
    try {
      await run.runner?.interrupt();
    } catch (error) {
      run.interrupted = false;
      throw error;
    }
  }
  private fail(
    run: ManagedRun,
    error: unknown,
    update: (patch: { status: 'failed'; error: string }) => void,
  ) {
    if (run.closed) return;
    const message = redactText(
      error instanceof Error ? error.message : 'Claude Code run failed',
    );
    run.summary.error = message;
    for (const notify of run.updates)
      notify({ status: 'failed', error: message });
    run.updates = [];
    this.stop(run);
    run.summary.state = 'failed';
    update({ status: 'failed', error: message });
    this.emitRun(run);
  }
  stop(run: ManagedRun) {
    if (run.closed) return;
    run.closed = true;
    clearTimeout(run.idle);
    clearTimeout(run.startTimer);
    run.abort.abort();
    run.queue.close();
    run.runner?.close();
    for (const notify of run.updates)
      notify({
        status: 'failed',
        error: 'Run stopped before the message was delivered',
      });
    run.updates = [];
    run.summary.state = 'ended';
    run.summary.queued = 0;
    this.resolved(run.summary.runId);
    this.emitRun(run);
  }
  async close() {
    this.closed = true;
    const runs = [...this.runs.values()];
    for (const run of runs) this.stop(run);
    await Promise.all(runs.map((run) => run.ready));
  }
}
