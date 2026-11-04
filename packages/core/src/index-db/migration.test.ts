import Database from 'better-sqlite3';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as schema from './schema.js';
import { migrationSql, schemaVersion } from './migration.js';

it('applies the bundled migration with every Drizzle table, column, type and primary key', () => {
  const db = new Database(':memory:');
  try {
    db.exec(migrationSql);
    for (const table of Object.values(schema)) {
      const config = getTableConfig(table);
      const columns = db.pragma(`table_info('${config.name}')`) as {
        name: string;
        type: string;
        pk: number;
      }[];
      expect(columns.map((c) => c.name)).toEqual(
        config.columns.map((c) => c.name),
      );
      for (const column of config.columns) {
        expect(
          columns.find((c) => c.name === column.name)?.type.toLowerCase(),
        ).toBe(column.getSQLType());
      }
      const pk = config.primaryKeys.flatMap((k) =>
        k.columns.map((c) => c.name),
      );
      if (pk.length)
        expect(
          columns
            .filter((c) => c.pk)
            .sort((a, b) => a.pk - b.pk)
            .map((c) => c.name),
        ).toEqual(pk);
    }
    const journal = JSON.parse(
      readFileSync(
        new URL('./migrations/meta/_journal.json', import.meta.url),
        'utf8',
      ),
    ) as { entries: { tag: string }[] };
    expect(schemaVersion).toBe(journal.entries.at(-1)?.tag);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    db.close();
  }
});
