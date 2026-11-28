import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { StrandSnapshot } from "../../shared/apiTypes";

export type SceneRow = {
  id: string;
  deviceId: string;
  name: string;
  strandKey: string;
  ledCount: number;
  content: StrandSnapshot;
  createdAt: string;
  updatedAt: string;
};

type DbRow = {
  id: string;
  device_id: string;
  name: string;
  strand_key: string;
  led_count: number;
  content: string;
  created_at: string;
  updated_at: string;
};

function toRow(r: DbRow): SceneRow {
  return {
    id: r.id,
    deviceId: r.device_id,
    name: r.name,
    strandKey: r.strand_key,
    ledCount: r.led_count,
    content: JSON.parse(r.content) as StrandSnapshot,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function list(db: DatabaseSync, deviceId: string): SceneRow[] {
  return (db.prepare("SELECT * FROM scenes WHERE device_id = ? ORDER BY created_at, rowid").all(deviceId) as DbRow[]).map(toRow);
}

export function get(db: DatabaseSync, deviceId: string, id: string): SceneRow | undefined {
  const r = db.prepare("SELECT * FROM scenes WHERE device_id = ? AND id = ?").get(deviceId, id) as DbRow | undefined;
  return r && toRow(r);
}

export function count(db: DatabaseSync, deviceId: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM scenes WHERE device_id = ?").get(deviceId) as { n: number }).n;
}

export function insert(
  db: DatabaseSync,
  row: { deviceId: string; name: string; strandKey: string; ledCount: number; content: StrandSnapshot },
  now: Date,
): SceneRow {
  const id = randomUUID();
  const at = now.toISOString();
  db.prepare(
    `INSERT INTO scenes (id, device_id, name, strand_key, led_count, content, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  .run(id, row.deviceId, row.name, row.strandKey, row.ledCount, JSON.stringify(row.content), at, at);
  return get(db, row.deviceId, id)!;
}

/** Renames a scene. Undefined when the scene is gone. */
export function rename(db: DatabaseSync, deviceId: string, id: string, name: string, now: Date): SceneRow | undefined {
  db.prepare("UPDATE scenes SET name = ?, updated_at = ? WHERE device_id = ? AND id = ?")
  .run(name, now.toISOString(), deviceId, id);
  return get(db, deviceId, id);
}

/** Returns whether a scene was removed. */
export function remove(db: DatabaseSync, deviceId: string, id: string): boolean {
  return db.prepare("DELETE FROM scenes WHERE device_id = ? AND id = ?").run(deviceId, id).changes > 0;
}
