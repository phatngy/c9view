import { Hono } from 'hono';
import { createNodeApp } from './app.js';
import { DataStore, type ServerConfig } from './data/store.js';

/** Legacy route tests retain their /api URLs while exercising the node app. */
export function createApp(
  config: ServerConfig,
  options: { store?: DataStore } = {},
) {
  return new Hono().route(
    '/api',
    createNodeApp({ store: options.store ?? new DataStore(config) }),
  );
}
