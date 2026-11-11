type Next = (specifier: string, context: unknown) => Promise<unknown>;

export async function resolve(
  specifier: string,
  context: unknown,
  next: Next,
): Promise<unknown> {
  if (specifier === '@anthropic-ai/claude-agent-sdk')
    return {
      url: new URL('./control-fake-sdk.ts', import.meta.url).href,
      shortCircuit: true,
    };
  return next(specifier, context);
}
