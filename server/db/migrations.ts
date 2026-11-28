/**
 * The schema, as an ordered list of SQL scripts. Entry n (1-based) sets
 * `PRAGMA user_version` to n. The list is append-only: never edit or reorder
 * an entry that is committed; a change is a new entry.
 */
export const migrations: string[] = [
  `
  CREATE TABLE devices (
    id              TEXT PRIMARY KEY,
    mac             TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    host            TEXT NOT NULL,
    port            INTEGER NOT NULL DEFAULT 80,
    last_ip         TEXT NOT NULL,
    last_seen       TEXT,
    pending_reboot  TEXT,
    pending_since   TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE preferences (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  `,
  `
  CREATE TABLE scenes (
    id          TEXT PRIMARY KEY,                -- UUID v4
    device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,                   -- 1-64 characters
    strand_key  TEXT NOT NULL,                   -- "o0" or "o0+o1"
    led_count   INTEGER NOT NULL,                -- the strand's length at save time
    content     TEXT NOT NULL,                   -- JSON StrandSnapshot
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE TABLE looks (
    id          TEXT PRIMARY KEY,
    device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    content     TEXT NOT NULL,                   -- JSON Look
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );
  CREATE TABLE strand_groups (
    device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    strand_key  TEXT NOT NULL,                   -- "o0+o1"
    PRIMARY KEY (device_id, strand_key)
  );
  `,
];
