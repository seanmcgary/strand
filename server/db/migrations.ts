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
];
