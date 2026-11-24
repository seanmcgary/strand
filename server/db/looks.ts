import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Look } from "../../shared/apiTypes";

export type LookRow = {
  id: string;
  deviceId: string;
  name: string;
  look: Look;
  createdAt: string;
  updatedAt: string;
};

type DbRow = {
  id: string;
  device_id: string;
  name: string;
  content: string;
  created_at: string;
  updated_at: string;
};

function toRow(r: DbRow): LookRow {
  return {
    id: r.id,
    deviceId: r.device_id,
    name: r.name,
    look: JSON.parse(r.content) as Look,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function list(db: DatabaseSync, deviceId: string): LookRow[] {
  return (db.prepare("SELECT * FROM looks WHERE device_id = ? ORDER BY created_at, rowid").all(deviceId) as DbRow[]).map(toRow);
}

export function get(db: DatabaseSync, deviceId: string, id: string): LookRow | undefined {
  const r = db.prepare("SELECT * FROM looks WHERE device_id = ? AND id = ?").get(deviceId, id) as DbRow | undefined;
  return r && toRow(r);
}

export function count(db: DatabaseSync, deviceId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM looks WHERE device_id = ?").get(deviceId) as { n: number }).n;
}

export function insert(db: DatabaseSync, row: { deviceId: string; name: string; look: Look }, now: Date): LookRow {
  const id = randomUUID();
  const at = now.toISOString();
  db.prepare("INSERT INTO looks (id, device_id, name, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
  .run(id, row.deviceId, row.name, JSON.stringify(row.look), at, at);
  return get(db, row.deviceId, id)!;
}

/** Renames a look. Undefined when the look is gone. */
export function rename(db: DatabaseSync, deviceId: string, id: string, name: string, now: Date): LookRow | undefined {
  db.prepare("UPDATE looks SET name = ?, updated_at = ? WHERE device_id = ? AND id = ?")
  .run(name, now.toISOString(), deviceId, id);
  return get(db, deviceId, id);
}

/** Returns whether a look was removed. */
export function remove(db: DatabaseSync, deviceId: string, id: string): boolean {
  return db.prepare("DELETE FROM looks WHERE device_id = ? AND id = ?").run(deviceId, id).changes > 0;
}
