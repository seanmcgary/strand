import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./database";
import * as preferences from "./preferences";

const now = new Date("2026-10-23T10:00:00.000Z");

describe("preferences", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  // Fails if values are not stored as JSON and parsed back.
  it("stores a value and reads it back", () => {
    preferences.put(db, "fav", ["Chase"], now);
    expect(preferences.getAll(db)).toEqual({ fav: ["Chase"] });
    expect(preferences.count(db)).toBe(1);
    expect(preferences.has(db, "fav")).toBe(true);
    expect(preferences.has(db, "other")).toBe(false);
  });

  // Fails if put inserts a second row (or throws) instead of replacing the value.
  it("replaces the value of an existing key", () => {
    preferences.put(db, "fav", ["Chase"], now);
    preferences.put(db, "fav", ["Rainbow"], now);
    expect(preferences.getAll(db)).toEqual({ fav: ["Rainbow"] });
    expect(preferences.count(db)).toBe(1);
  });
});
