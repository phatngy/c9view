import type { RunMode } from '@c9view/api';
import type {
  Runner,
  RunnerMessage,
  RunnerOptions,
  SdkAdapter,
  UserInput,
} from './sdk.js';
import { Queue } from './queue.js';
export class FakeRunner implements Runner {
  readonly messages = new Queue<RunnerMessage>();
  readonly inputs: UserInput[] = [];
  readonly modes: RunMode[] = [];
  interrupts = 0;
  closed = false;
  constructor(
    readonly options: RunnerOptions,
    input: AsyncIterable<UserInput>,
  ) {
    void (async () => {
      for await (const message of input) this.inputs.push(message);
    })();
  }
  [Symbol.asyncIterator]() {
    return this.messages[Symbol.asyncIterator]();
  }
  init(
    sessionId = this.options.sessionId ?? this.options.resume ?? 'fake-session',
  ) {
    this.messages.push({
      type: 'system',
      subtype: 'init',
      session_id: sessionId,
    });
  }
  result(cost = 0) {
    this.messages.push({ type: 'result', total_cost_usd: cost });
  }
  permission(
    tool: string,
    input: Record<string, unknown>,
    signal = new AbortController().signal,
  ) {
    return this.options.canUseTool(tool, input, { signal });
  }
  async interrupt() {
    this.interrupts++;
  }
  async setPermissionMode(mode: RunMode) {
    this.modes.push(mode);
  }
  close() {
    this.closed = true;
    this.messages.close();
  }
}
export class FakeSdk {
  readonly runs: FakeRunner[] = [];
  startDelay?: Promise<void>;
  readonly adapter: SdkAdapter = async (input, options) => {
    await this.startDelay;
    const run = new FakeRunner(options, input);
    this.runs.push(run);
    return run;
  };
}
