import { redactStrings } from '../data/redaction.js';
import { Hono } from 'hono';
import { readConfig } from '../data/config.js';
import type { DataStore } from '../data/store.js';
export function configRoutes(store: DataStore) {
  const app = new Hono();
  app.get('/config', async (c) =>
    c.json(redactStrings(await readConfig(store.config.claudeDir))),
  );
  return app;
}
