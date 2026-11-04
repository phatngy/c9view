import { redactStrings } from '../data/redaction.js';
import { Hono } from 'hono';
import { VERSION } from '@c9view/core';
import type { HealthResponse } from '@c9view/api';
import type { DataStore } from '../data/store.js';
export function healthRoutes(store: DataStore) {
  const app = new Hono();
  app.get('/health', (c) => {
    const response: HealthResponse = {
      ok: true,
      version: VERSION,
      claudeDir: store.config.claudeDir,
    };
    return c.json(redactStrings(response));
  });
  return app;
}
