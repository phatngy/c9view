import type { Message, TokenTotals } from '@c9view/api';
import { classifyMessage } from './markup.js';

export interface TurnSummary {
  startId: string;
  endId: string;
  endAt: string | null;
  requests: number;
  output: number;
  /** Newly supplied input, excluding cached context. */
  fresh: number;
  /** Input includes newly created and cached context. */
  input: number;
  cacheRead: number;
  cacheHit: number | null;
}

export function buildTurns(messages: Message[]): {
  turns: TurnSummary[];
  thinkingDurations: Map<string, number>;
  thinkingTokens: Map<string, number>;
} {
  const turns: TurnSummary[] = [];
  const thinkingDurations = new Map<string, number>();
  const thinkingTokens = new Map<string, number>();
  let firstThinking: string | undefined;
  let requestThinking = 0;
  let turn: TurnSummary | undefined;
  let request = false;
  let hasPrompt = false;
  let hasUsage = false;
  let usage: TokenTotals | null = null;
  function finishRequest() {
    if (request && turn) {
      turn.requests++;
      if (usage) {
        hasUsage = true;
        turn.output += usage.output;
        turn.fresh += usage.input + usage.cacheCreation;
        turn.input += usage.input + usage.cacheCreation + usage.cacheRead;
        turn.cacheRead += usage.cacheRead;
        turn.cacheHit = turn.input > 0 ? turn.cacheRead / turn.input : null;
      }
    }
    if (firstThinking) thinkingTokens.set(firstThinking, requestThinking);
    firstThinking = undefined;
    requestThinking = 0;
    request = false;
    usage = null;
  }
  function finishTurn() {
    finishRequest();
    // An incomplete prefix without recorded usage has no meaningful divider.
    if (turn && !hasPrompt && !hasUsage) turn.requests = 0;
  }
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!;
    if (message.blocks.some((block) => block.type === 'thinking')) {
      const previous = messages[i - 1];
      if (message.timestamp && previous?.timestamp) {
        const delta =
          Date.parse(message.timestamp) - Date.parse(previous.timestamp);
        if (delta > 0 && delta <= 600_000)
          thinkingDurations.set(message.uuid, delta);
      }
    }
    const prompt = classifyMessage(message).kind === 'prompt';
    if (prompt || !turn) {
      finishTurn();
      hasPrompt = prompt;
      hasUsage = false;
      turn = {
        startId: message.uuid,
        endId: message.uuid,
        endAt: message.timestamp,
        requests: 0,
        output: 0,
        fresh: 0,
        input: 0,
        cacheRead: 0,
        cacheHit: null,
      };
      turns.push(turn);
    }
    if (message.role !== 'assistant' || message.isSidechain) finishRequest();
    else {
      request = true;
      if (
        !firstThinking &&
        message.blocks.some((block) => block.type === 'thinking')
      )
        firstThinking = message.uuid;
      requestThinking = Math.max(requestThinking, message.usage?.thinking ?? 0);
      if (message.usage) usage = message.usage;
    }
    turn.endId = message.uuid;
    turn.endAt = message.timestamp;
  }
  finishTurn();
  return { turns, thinkingDurations, thinkingTokens };
}
