import { Hono } from 'hono';
import { VERSION } from '@c9view/core';
import { redactStrings } from '../data/redaction.js';
import type { DataStore } from '../data/store.js';

/** The hub adds `ok: true` to this node-owned health payload. */
export async function nodeHealth(store: DataStore) {
  return redactStrings({
    version: VERSION,
    claudeDir: store.config.claudeDir,
    index: store.indexHealth,
    hooks: await store.hooks.health(store.config.claudeDir),
  });
}
export function healthRoutes(store: DataStore) {
  const app = new Hono();
  app.get('/health', async (c) => c.json(await nodeHealth(store)));
  return app;
}
