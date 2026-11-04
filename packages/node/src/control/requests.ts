import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type {
  ControlEvent,
  ControlQuestion,
  ControlRequest,
  DecisionBody,
} from '@c9view/api';
import type { CanUseTool, ToolResult } from './sdk.js';
import { redactStrings } from '../data/redaction.js';
import { ControlError } from './errors.js';
const questionsSchema = z.object({
  questions: z
    .array(
      z.object({
        question: z.string(),
        header: z.string(),
        options: z
          .array(z.object({ label: z.string(), description: z.string() }))
          .min(2)
          .max(4),
        multiSelect: z.boolean(),
      }),
    )
    .min(1)
    .max(4),
});
interface Pending {
  card: ControlRequest;
  input: Record<string, unknown>;
  questions?: ControlQuestion[] | undefined;
  finish: (result: ToolResult) => void;
}
export class Requests {
  private pending = new Map<string, Pending>();
  private decided = new Set<string>();
  constructor(
    private timeoutMs: number,
    private emit: (event: ControlEvent) => void,
    private changed: (runId: string, waiting: boolean) => void,
  ) {}
  snapshot() {
    return structuredClone([...this.pending.values()].map((p) => p.card));
  }
  handler(runId: string, sessionId: () => string): CanUseTool {
    return async (tool, input, { signal }) => {
      if (signal.aborted)
        return { behavior: 'deny', message: 'Request aborted' };
      const requestId = randomUUID();
      const base = {
        requestId,
        runId,
        sessionId: sessionId(),
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.timeoutMs).toISOString(),
      };
      const parsed =
        tool === 'AskUserQuestion'
          ? questionsSchema.safeParse(input)
          : undefined;
      if (tool === 'AskUserQuestion' && !parsed?.success)
        return { behavior: 'deny', message: 'Unsupported question format' };
      const card: ControlRequest = parsed?.success
        ? {
            ...base,
            kind: 'question',
            questions: redactStrings(parsed.data.questions),
          }
        : {
            ...base,
            kind: 'permission',
            toolName: redactStrings(tool),
            summary: redactStrings(JSON.stringify(input)),
          };
      return new Promise<ToolResult>((resolve) => {
        const finish = (result: ToolResult) => {
          if (!this.pending.delete(requestId)) return;
          clearTimeout(timer);
          signal.removeEventListener('abort', abort);
          this.decided.add(requestId);
          this.emit({ type: 'control.request.resolved', requestId });
          this.changed(
            runId,
            [...this.pending.values()].some((p) => p.card.runId === runId),
          );
          resolve(result);
        };
        const abort = () =>
          finish({ behavior: 'deny', message: 'Request aborted' });
        const timer = setTimeout(
          () =>
            finish({
              behavior: 'deny',
              message: 'No answer from the c9view user',
            }),
          this.timeoutMs,
        );
        timer.unref();
        this.pending.set(requestId, {
          card,
          input: structuredClone(input),
          questions: parsed?.success ? parsed.data.questions : undefined,
          finish,
        });
        signal.addEventListener('abort', abort, { once: true });
        this.changed(runId, true);
        this.emit({
          type: 'control.request',
          requestId,
          runId,
          sessionId: base.sessionId,
        });
      });
    };
  }
  decide(id: string, body: DecisionBody) {
    const pending = this.pending.get(id);
    if (!pending)
      throw new ControlError(
        this.decided.has(id) ? 409 : 404,
        this.decided.has(id) ? 'Request already decided' : 'Not found',
        this.decided.has(id) ? 'decided' : undefined,
      );
    if ('answers' in body) {
      if (!pending.questions || pending.card.kind !== 'question')
        throw new ControlError(400, 'This request needs a permission decision');
      if (Object.keys(body.answers).length !== pending.questions.length)
        throw new ControlError(400, 'Answer every question');
      const answers: Record<string, string | string[]> = {};
      for (const [index, question] of pending.questions.entries()) {
        const visible = pending.card.questions[index]!;
        const answer = body.answers[visible.question];
        const values = Array.isArray(answer) ? answer : [answer];
        if (
          !values.length ||
          (!question.multiSelect && values.length !== 1) ||
          values.some(
            (value) =>
              typeof value !== 'string' || !value.length || value.length > 2000,
          ) ||
          new Set(values).size !== values.length
        )
          throw new ControlError(400, 'Invalid answer');
        const original = values.map((value) => {
          const option = visible.options.findIndex(
            (option) => option.label === value,
          );
          return option >= 0 ? question.options[option]!.label : value!;
        });
        answers[question.question] = Array.isArray(answer)
          ? original
          : original[0]!;
      }
      pending.finish({
        behavior: 'allow',
        updatedInput: {
          ...pending.input,
          answers,
        },
      });
    } else if (body.decision === 'deny')
      pending.finish({
        behavior: 'deny',
        message: body.message ?? 'Denied by the c9view user',
      });
    else {
      if (pending.questions)
        throw new ControlError(400, 'This request needs answers');
      pending.finish({ behavior: 'allow', updatedInput: pending.input });
    }
  }
  close(runId?: string) {
    for (const p of [...this.pending.values()])
      if (!runId || p.card.runId === runId)
        p.finish({ behavior: 'deny', message: 'Run closed' });
  }
}
