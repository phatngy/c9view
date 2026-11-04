import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/index-db/schema.ts',
  out: './src/index-db/migrations',
});
