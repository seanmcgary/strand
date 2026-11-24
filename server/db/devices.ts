import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type DeviceRow = {
  id: string;
  mac: string;
  name: string;
  host: string;
  port: number;
  lastIp: string;
  lastSeen: string | null;
  pendingReboot: string[];
  pendingSince: string | null;
  createdAt: string;
  updatedAt: string;
};

type DbRow = {
  id: string;
  mac: string;
  name: string;
  host: string;
  port: number;
  last_ip: string;
  last_seen: string | null;
  pending_reboot: string | null;
  pending_since: string | null;
  created_at: string;
  updated_at: string;
};

function toRow(r: DbRow): DeviceRow {
  return {
    id: r.id,
    mac: r.mac,
    name: r.name,
    host: r.host,
    port: r.port,
    lastIp: r.last_ip,
    lastSeen: r.last_seen,
    pendingReboot: r.pending_reboot === null ? [] : (JSON.parse(r.pending_reboot) as string[]),
    pendingSince: r.pending_since,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function list(db: DatabaseSync): DeviceRow[] {
  return (db.prepare("SELECT * FROM devices ORDER BY created_at, rowid").all() as DbRow[]).map(toRow);
}

export function get(db: DatabaseSync, id: string): DeviceRow | undefined {
  const r = db.prepare("SELECT * FROM devices WHERE id = ?").get(id) as DbRow | undefined;
  return r && toRow(r);
}

export function getByMac(db: DatabaseSync, mac: string): DeviceRow | undefined {
  const r = db.prepare("SELECT * FROM devices WHERE mac = ?").get(mac) as DbRow | undefined;
  return r && toRow(r);
}

/** Adds a device. Throws if a device with the same MAC exists. */
export function insert(
  db: DatabaseSync,
  row: { mac: string; name: string; host: string; port: number; lastIp: string },
  now: Date,
): DeviceRow {
  const id = randomUUID();
  const at = now.toISOString();
  db.prepare(
    `INSERT INTO devices (id, mac, name, host, port, last_ip, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  .run(id, row.mac, row.name, row.host, row.port, row.lastIp, at, at);
  return get(db, id)!;
}

/** Returns whether a device was removed. */
export function remove(db: DatabaseSync, id: string): boolean {
  return db.prepare("DELETE FROM devices WHERE id = ?").run(id).changes > 0;
}

/** Records a good `/json/info` reply: the device's name, the address that answered, and the time. */
export function recordSeen(db: DatabaseSync, id: string, seen: { name: string; lastIp: string }, now: Date): void {
  const at = now.toISOString();
  db.prepare("UPDATE devices SET name = ?, last_ip = ?, last_seen = ?, updated_at = ? WHERE id = ?")
  .run(seen.name, seen.lastIp, at, at, id);
}

export function setLastIp(db: DatabaseSync, id: string, lastIp: string, now: Date): void {
  db.prepare("UPDATE devices SET last_ip = ?, updated_at = ? WHERE id = ?")
  .run(lastIp, now.toISOString(), id);
}

/** Adds `names` to the device's pending-reboot list (keeping order, without duplicates) and sets `pending_since`. */
export function addPendingReboot(db: DatabaseSync, id: string, names: string[], now: Date): void {
  if (names.length === 0) return;
  const at = now.toISOString();
  const current = get(db, id)?.pendingReboot ?? [];
  const merged = [...new Set([...current, ...names])];
  db.prepare("UPDATE devices SET pending_reboot = ?, pending_since = ?, updated_at = ? WHERE id = ?")
  .run(JSON.stringify(merged), at, at, id);
}

export function clearPendingReboot(db: DatabaseSync, id: string, now: Date): void {
  db.prepare("UPDATE devices SET pending_reboot = NULL, pending_since = NULL, updated_at = ? WHERE id = ?")
  .run(now.toISOString(), id);
}
