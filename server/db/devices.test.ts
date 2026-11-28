import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { openDb } from "./database";
import * as devices from "./devices";

const t0 = new Date("2026-10-23T10:00:00.000Z");
const t1 = new Date("2026-10-23T11:00:00.000Z");

function addDevice(db: DatabaseSync, mac: string, now = t0): devices.DeviceRow {
  return devices.insert(db, { mac, name: `WLED ${mac}`, host: "wled-a.local", port: 80, lastIp: "192.168.1.10" }, now);
}

describe("devices", () => {
  let db: DatabaseSync;
  beforeEach(() => {
    db = openDb(":memory:");
  });

  // Fails if the UNIQUE constraint on mac is dropped.
  it("rejects a second device with the same MAC", () => {
    addDevice(db, "aabbccddeeff");
    expect(() => addDevice(db, "aabbccddeeff")).toThrow();
  });

  // Fails if addPendingReboot replaces the list instead of a de-duplicated, order-keeping union.
  it("adds pending-reboot reasons as a union", () => {
    const row = addDevice(db, "aabbccddeeff");
    devices.addPendingReboot(db, row.id, ["hostname"], t0);
    devices.addPendingReboot(db, row.id, ["static IP", "hostname"], t1);
    expect(devices.get(db, row.id)).toMatchObject({ pendingReboot: ["hostname", "static IP"], pendingSince: t1.toISOString() });
  });

  // Fails if an empty list marks the device as waiting for a reboot (pending_since set with nothing pending).
  it("ignores an empty list of pending-reboot reasons", () => {
    const row = addDevice(db, "aabbccddeeff");
    devices.addPendingReboot(db, row.id, [], t1);
    expect(devices.get(db, row.id)).toEqual(row);
  });

});
