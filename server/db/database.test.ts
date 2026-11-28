import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { openDb, runMigrations } from "./database";
import * as devices from "./devices";
import * as looks from "./looks";
import { migrations } from "./migrations";
import * as scenes from "./scenes";
import * as strandGroups from "./strandGroups";

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

  // Fails if a scenes, looks or strand_groups foreign key loses ON DELETE CASCADE, or openDb stops turning foreign keys on.
  it("deletes a device's scenes, looks and strand groups with the device", () => {
    const db = openDb(":memory:");
    const now = new Date("2026-11-24T00:00:00Z");
    const { id } = devices.insert(db, { mac: "aabbccddeeff", name: "Backyard", host: "wled.local", port: 80, lastIp: "10.0.0.2" }, now);
    const slot = {
      col: [[255, 0, 0]], fx: 0, fxName: "Solid", sx: 128, ix: 128, c1: 0, c2: 0, c3: 0,
      o1: false, o2: false, o3: false, pal: 0, palName: "Default",
    };
    scenes.insert(db, {
      deviceId: id, name: "Party", strandKey: "o0", ledCount: 10,
      content: { on: true, bri: 255, ranges: [{ name: "All", start: 0, len: 10, pattern: { kind: "all" }, slots: [slot] }] },
    }, now);
    looks.insert(db, { deviceId: id, name: "Red", look: { pattern: { kind: "all" }, slots: [slot] } }, now);
    strandGroups.replace(db, id, ["o0+o1"]);
    devices.remove(db, id);
    expect(scenes.list(db, id)).toEqual([]);
    expect(looks.list(db, id)).toEqual([]);
    expect(strandGroups.list(db, id)).toEqual([]);
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
