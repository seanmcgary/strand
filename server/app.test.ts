import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { loadConfig } from "./config";

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
