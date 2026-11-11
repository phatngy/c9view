// Deterministic stand-in for `@anthropic-ai/claude-agent-sdk` (see
// control-sdk-register.ts). It answers every user message with a synthetic
// reply and records it in the fixture transcript, so the index and the web
// page see it like a real turn. A prompt containing "needs-approval" first asks
// for permission to run a synthetic Bash command.
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

if (process.env.C9VIEW_E2E_FAKE_SDK !== '1')
  throw new Error('The fake Agent SDK is only for the e2e control server');

interface Input {
  message: { content: string };
}
interface Options {
  cwd: string;
  sessionId?: string;
  resume?: string;
  canUseTool: (
    tool: string,
    input: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<{ behavior: string; message?: string }>;
  abortController: AbortController;
}

function transcript(options: Options, sessionId: string) {
  const directory = process.env.C9VIEW_E2E_FAKE_PROJECT_DIR!;
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${sessionId}.jsonl`);
  const write = (line: object) =>
    appendFileSync(file, `${JSON.stringify(line)}\n`);
  return {
    user: (text: string) =>
      write({
        type: 'user',
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
        cwd: options.cwd,
        version: '2.1.0',
        message: { role: 'user', content: text },
      }),
    assistant: (text: string) =>
      write({
        type: 'assistant',
        uuid: randomUUID(),
        timestamp: new Date().toISOString(),
        message: {
          role: 'assistant',
          id: randomUUID(),
          model: 'claude-sonnet-4-5',
          content: [{ type: 'text', text }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      }),
  };
}

export function query({
  prompt,
  options,
}: {
  prompt: AsyncIterable<Input>;
  options: Options;
}) {
  const sessionId = options.sessionId ?? options.resume ?? randomUUID();
  const out: object[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  const push = (message: object) => {
    out.push(message);
    wake?.();
  };
  void (async () => {
    const log = transcript(options, sessionId);
    push({ type: 'system', subtype: 'init', session_id: sessionId });
    for await (const input of prompt) {
      const text = input.message.content;
      log.user(text);
      let reply = `Synthetic reply to: ${text}`;
      if (text.includes('needs-approval')) {
        const decision = await options.canUseTool(
          'Bash',
          { command: 'echo synthetic-approval' },
          { signal: options.abortController.signal },
        );
        reply =
          decision.behavior === 'allow'
            ? 'Synthetic command approved'
            : 'Synthetic command denied';
      }
      log.assistant(reply);
      push({ type: 'result', total_cost_usd: 0 });
    }
  })();
  return {
    async *[Symbol.asyncIterator]() {
      while (!closed || out.length) {
        const next = out.shift();
        if (next) yield next;
        else await new Promise<void>((resolve) => (wake = resolve));
      }
    },
    async interrupt() {},
    async setPermissionMode() {},
    close() {
      closed = true;
      wake?.();
    },
  };
}
