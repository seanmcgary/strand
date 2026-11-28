import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { makeTestApp } from "../test/testApp";

const INDEX = "<!doctype html><title>index</title>";
let webDistDir: string;
let app: FastifyInstance;

beforeAll(() => {
  webDistDir = mkdtempSync(join(tmpdir(), "strand-web-"));
  writeFileSync(join(webDistDir, "index.html"), INDEX);
  mkdirSync(join(webDistDir, "assets"));
  writeFileSync(join(webDistDir, "assets", "a.js"), "console.log(1)");
  app = buildApp({
    config: { ...loadConfig({}), webDistDir },
    db: new DatabaseSync(":memory:"),
    mdns: { browseWled: async () => [], resolveA: async () => null },
    now: () => new Date(),
    wledPort: 80,
    scanDelayMs: 1,
    logger: false,
  });
});

afterAll(async () => {
  await app.close();
  rmSync(webDistDir, { recursive: true, force: true });
});

const get = (url: string) => app.inject({ method: "GET", url, headers: { host: "localhost" } });

describe("buildApp", () => {
  // Fails if / stops serving the built index.html.
  it("serves index.html at /", async () => {
    const res = await get("/");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX);
  });

  // Fails if browser routes stop falling back to index.html.
  it("serves index.html for a browser route", async () => {
    const res = await get("/devices/abc/settings/network");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX);
  });

  // Fails if static files stop being served.
  it("serves a built file", async () => {
    const res = await get("/assets/a.js");
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("console.log(1)");
  });

  // Fails if an unknown /api path gets the SPA or loses its JSON error and no-store.
  it("answers an unknown /api path with a JSON 404", async () => {
    const res = await get("/api/nope");
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found", message: "That page doesn't exist." });
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  // Fails if the SPA fallback answers methods other than GET.
  it("does not fall back for POST", async () => {
    const res = await app.inject({ method: "POST", url: "/devices/x", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(404);
  });
});

describe("request guard on every route", () => {
  const writes: [string, string, object | undefined][] = [
    ["POST", "/api/devices", { host: "10.0.0.5" }],
    ["POST", "/api/devices/probe", { host: "10.0.0.5" }],
    ["DELETE", "/api/devices/x", undefined],
    ["PATCH", "/api/devices/x/config", { name: "n" }],
    ["POST", "/api/devices/x/unlock", {}],
    ["POST", "/api/devices/x/reboot", {}],
    ["POST", "/api/devices/x/networks/scan", {}],
    ["PATCH", "/api/devices/x/state", { on: true }],
    ["PATCH", "/api/devices/x/lights", { on: true }],
    ["POST", "/api/devices/x/scenes", { name: "a", strandKey: "o0" }],
    ["PATCH", "/api/devices/x/scenes/y", { name: "a" }],
    ["DELETE", "/api/devices/x/scenes/y", undefined],
    ["POST", "/api/devices/x/scenes/y/apply", undefined],
    ["POST", "/api/devices/x/looks", { name: "a", strandKey: "o0", range: "r" }],
    ["PATCH", "/api/devices/x/looks/y", { name: "a" }],
    ["DELETE", "/api/devices/x/looks/y", undefined],
    ["POST", "/api/devices/x/looks/y/apply", { targets: [{ strandKey: "o0" }] }],
    ["POST", "/api/devices/x/lights/flash", { strandKey: "o0", led: 0 }],
    ["PATCH", "/api/devices/x/lights/strands/o0", { bri: 90 }],
    ["POST", "/api/devices/x/lights/strands/o0/resolve", { action: "split" }],
    ["PUT", "/api/devices/x/strand-groups", { keys: [] }],
    ["PUT", "/api/devices/x/strand-names", { names: {} }],
    ["PUT", "/api/preferences/k", { value: "v" }],
  ];
  const variants: [string, Record<string, string>][] = [
    ["no x-strand-request", { host: "localhost" }],
    ["a foreign origin", { host: "localhost", "x-strand-request": "1", origin: "http://evil.example.com" }],
    ["a foreign host", { host: "evil.example.com", "x-strand-request": "1" }],
  ];
  const cases = writes.flatMap(([method, url, payload]) =>
    variants.map(([variant, headers]) => ({ method, url, payload, variant, headers })),
  );

  // Fails if a route is registered outside the /api guard.
  it.each(cases)("rejects $method $url with $variant", async ({ method, url, payload, headers }) => {
    const t = makeTestApp();
    const res = await t.app.inject({
      method: method as "POST",
      url,
      headers: { ...headers, ...(payload ? { "content-type": "application/json" } : {}) },
      payload,
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual(expect.objectContaining({ error: "invalid_request" }));
  });

  const reads = [
    "/api/devices",
    "/api/discovery",
    "/api/preferences",
    ...["info", "config", "capabilities", "pins", "state", "effects", "palettes", "pending-reboot", "lights", "strand-groups", "scenes", "looks"].map(
      (r) => `/api/devices/x/${r}`,
    ),
  ];

  // Fails if a route is registered outside the /api guard.
  it.each(reads)("rejects GET %s with a foreign host", async (url) => {
    const t = makeTestApp();
    const res = await t.app.inject({ method: "GET", url, headers: { host: "evil.example.com" } });
    expect(res.statusCode).toBe(403);
  });
});
