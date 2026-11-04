import type { Message } from '@c9view/api';

const observedContext = (message: Message | undefined) => {
  const u = message?.usage;
  return u ? u.input + u.cacheRead + u.cacheCreation : 0;
};
export function contextWindow(model: string | null, messages: Message[] = []) {
  return model?.endsWith('[1m]') ||
    messages.some(
      (m) =>
        m.role === 'assistant' &&
        (observedContext(m) > 200_000 || m.model?.endsWith('[1m]')),
    )
    ? 1_000_000
    : 200_000;
}
export function contextUsage(messages: Message[]) {
  const message = messages.findLast(
    (m) =>
      m.role === 'assistant' && !m.isSidechain && m.model !== '<synthetic>',
  );
  const used = observedContext(message);
  const capacity = contextWindow(message?.model ?? null, messages);
  return { used, capacity, percent: (used / capacity) * 100 };
}
