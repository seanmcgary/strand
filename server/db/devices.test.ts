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

  // Fails if insert does not store every column, or get/getByMac map a column wrong.
  it("finds an inserted device by id and by MAC", () => {
    const row = addDevice(db, "aabbccddeeff");
    expect(row).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      mac: "aabbccddeeff",
      name: "WLED aabbccddeeff",
      host: "wled-a.local",
      port: 80,
      lastIp: "192.168.1.10",
      lastSeen: null,
      pendingReboot: [],
      pendingSince: null,
      createdAt: t0.toISOString(),
      updatedAt: t0.toISOString(),
    });
    expect(devices.get(db, row.id)).toEqual(row);
    expect(devices.getByMac(db, "aabbccddeeff")).toEqual(row);
  });

  // Fails if the UNIQUE constraint on mac is dropped.
  it("rejects a second device with the same MAC", () => {
    addDevice(db, "aabbccddeeff");
    expect(() => addDevice(db, "aabbccddeeff")).toThrow();
  });

  // Fails if list orders by MAC, id or name instead of creation time, then insert order.
  it("lists devices in insert order when they share a creation time", () => {
    const macs = ["ffffffffffff", "000000000000", "888888888888"];
    for (const mac of macs) addDevice(db, mac);
    expect(devices.list(db).map((d) => d.mac)).toEqual(macs);
  });

  // Fails if remove does not report whether a row was deleted.
  it("removes a device once", () => {
    const row = addDevice(db, "aabbccddeeff");
    expect(devices.remove(db, row.id)).toBe(true);
    expect(devices.remove(db, row.id)).toBe(false);
  });

  // Fails if recordSeen leaves name, last_ip or last_seen unchanged.
  it("records a successful contact", () => {
    const row = addDevice(db, "aabbccddeeff");
    devices.recordSeen(db, row.id, { name: "Porch", lastIp: "192.168.1.20" }, t1);
    expect(devices.get(db, row.id)).toEqual({
      ...row,
      name: "Porch",
      lastIp: "192.168.1.20",
      lastSeen: t1.toISOString(),
      updatedAt: t1.toISOString(),
    });
  });

  // Fails if setLastIp also touches last_seen or another column.
  it("changes only the address and update time", () => {
    const row = addDevice(db, "aabbccddeeff");
    devices.setLastIp(db, row.id, "192.168.1.30", t1);
    expect(devices.get(db, row.id)).toEqual({ ...row, lastIp: "192.168.1.30", updatedAt: t1.toISOString() });
  });

  // Fails if addPendingReboot replaces the list instead of a de-duplicated, order-keeping union.
  it("adds pending-reboot reasons as a union", () => {
    const row = addDevice(db, "aabbccddeeff");
    devices.addPendingReboot(db, row.id, ["hostname"], t0);
    devices.addPendingReboot(db, row.id, ["static IP", "hostname"], t1);
    expect(devices.get(db, row.id)).toMatchObject({ pendingReboot: ["hostname", "static IP"], pendingSince: t1.toISOString() });
  });

  // Fails if clearPendingReboot leaves the list or its time behind.
  it("clears pending-reboot reasons", () => {
    const row = addDevice(db, "aabbccddeeff");
    devices.addPendingReboot(db, row.id, ["hostname"], t0);
    devices.clearPendingReboot(db, row.id, t1);
    expect(devices.get(db, row.id)).toMatchObject({ pendingReboot: [], pendingSince: null, updatedAt: t1.toISOString() });
  });
});
