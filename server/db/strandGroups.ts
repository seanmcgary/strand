import type { DatabaseSync } from "node:sqlite";

/** The device's combined strand keys ("o0+o1"), in the order they were saved. */
export function list(db: DatabaseSync, deviceId: string): string[] {
  return (db.prepare("SELECT strand_key FROM strand_groups WHERE device_id = ? ORDER BY rowid").all(deviceId) as { strand_key: string }[])
  .map((r) => r.strand_key);
}

/** Replaces the device's combined strand keys, in one transaction. */
export function replace(db: DatabaseSync, deviceId: string, keys: string[]): void {
  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM strand_groups WHERE device_id = ?").run(deviceId);
    const add = db.prepare("INSERT INTO strand_groups (device_id, strand_key) VALUES (?, ?)");
    for (const key of keys) add.run(deviceId, key);
    db.exec("COMMIT");
  } catch (err) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw err;
  }
}
