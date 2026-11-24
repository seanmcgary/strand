import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations";

/**
 * Applies each entry of `list` after the database's `user_version`. Each entry
 * runs in its own transaction, which also sets `user_version`. A failing entry
 * is rolled back and its error rethrown; earlier entries stay applied.
 */
export function runMigrations(db: DatabaseSync, list: string[]): void {
  const { user_version: current } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  list.slice(current).forEach((sql, i) => {
    const n = current + i + 1;
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${n}`);
      db.exec("COMMIT");
    } catch (err) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw err;
    }
  });
}

/** Opens the database file (or `":memory:"`) and brings its schema up to date. */
export function openDb(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON");
  runMigrations(db, migrations);
  return db;
}
