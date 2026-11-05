import { Hono } from 'hono';
import { createNodeApp } from './app.js';
import { DataStore, type ServerConfig } from './data/store.js';
import { DEFAULT_NODE_LIMITS, type NodeLimits } from './limits.js';

/** Legacy route tests retain their /api URLs while exercising the node app. */
export function createApp(
  config: ServerConfig,
  options: { store?: DataStore; limits?: Partial<NodeLimits> } = {},
) {
  return new Hono().route(
    '/api',
    createNodeApp(
      { store: options.store ?? new DataStore(config) },
      { ...DEFAULT_NODE_LIMITS, ...options.limits },
    ),
  );
}
