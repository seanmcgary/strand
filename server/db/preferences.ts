import type { DatabaseSync } from "node:sqlite";

/** Every preference, keyed by name, with its JSON value parsed. */
export function getAll(db: DatabaseSync): Record<string, unknown> {
  const rows = db.prepare("SELECT key, value FROM preferences ORDER BY key").all() as { key: string; value: string }[];
  const result: Record<string, unknown> = {};
  for (const r of rows) result[r.key] = JSON.parse(r.value);
  return result;
}

export function count(db: DatabaseSync): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM preferences").get() as { n: number }).n;
}

export function has(db: DatabaseSync, key: string): boolean {
  return db.prepare("SELECT 1 FROM preferences WHERE key = ?").get(key) !== undefined;
}

/** Sets a preference, replacing any earlier value. */
export function put(db: DatabaseSync, key: string, value: unknown, now: Date): void {
  db.prepare(
    `INSERT INTO preferences (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
  .run(key, JSON.stringify(value), now.toISOString());
}
