/** Kept separate so CLI option tests do not need a built hub. */
export async function loadHub(entry: URL): Promise<{
  startServer: (options: Record<string, unknown>) => unknown;
}> {
  return import(entry.href);
}
