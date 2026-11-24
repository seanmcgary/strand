import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, runMigrations } from "./database";
import { migrations } from "./migrations";

function userVersion(db: DatabaseSync): number {
  return (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
}

describe("openDb", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  // Fails if openDb skips the migrations or does not record the version.
  it("migrates a new database to the latest version", () => {
    const db = openDb(":memory:");
    expect(userVersion(db)).toBe(migrations.length);
    db.close();
  });

  // Fails if a migration runs again on a database that already has it (CREATE TABLE would throw).
  it("opens a migrated file again without re-running migrations", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "strand-db-"));
    dirs.push(dir);
    const file = path.join(dir, "strand.db");
    openDb(file).close();
    const db = openDb(file);
    expect(userVersion(db)).toBe(migrations.length);
    db.close();
  });
});

describe("runMigrations", () => {
  // Fails if a failed entry is not rolled back alone, or the error is swallowed.
  it("keeps earlier entries and rethrows when an entry fails", () => {
    const db = new DatabaseSync(":memory:");
    expect(() => runMigrations(db, ["CREATE TABLE a(x)", "BROKEN SQL"])).toThrow();
    expect(userVersion(db)).toBe(1);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'a'").get()).toBeDefined();
    db.close();
  });
});
