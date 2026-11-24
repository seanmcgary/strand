import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { ApiError, messages } from "./errors";

let webDistDir: string;
let app: FastifyInstance;
let logLines: string[] = [];

beforeAll(() => {
  webDistDir = mkdtempSync(join(tmpdir(), "strand-web-"));
  app = buildApp({
    config: { ...loadConfig({}), webDistDir },
    db: new DatabaseSync(":memory:"),
    mdns: { browseWled: async () => [], resolveA: async () => null },
    now: () => new Date(),
    wledPort: 80,
    scanDelayMs: 1,
    logger: { stream: { write: (line: string) => void logLines.push(line) } },
  });
  app.get("/api/busy", async () => {
    throw new ApiError(503, "device_busy", "x");
  });
  app.get("/api/boom", async () => {
    throw Object.assign(new Error("boom"), { body: { pin: "1234" } });
  });
  app.post("/api/echo", async (request) => request.body);
});

beforeEach(() => {
  logLines = [];
});

afterAll(async () => {
  await app.close();
  rmSync(webDistDir, { recursive: true, force: true });
});

const post = (payload: string) =>
  app.inject({
    method: "POST",
    url: "/api/echo",
    headers: { host: "localhost", "content-type": "application/json", "x-strand-request": "1" },
    payload,
  });

const logged = () => logLines.map((line) => JSON.parse(line) as Record<string, unknown>);

describe("error handler", () => {
  // Fails if an ApiError loses its status, body, or the Retry-After header on device_busy.
  it("sends an ApiError as its status and body", async () => {
    const res = await app.inject({ method: "GET", url: "/api/busy", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(503);
    expect(res.headers["retry-after"]).toBe("1");
    expect(res.json()).toEqual({ error: "device_busy", message: "x" });
  });

  // Fails if an unexpected error leaks its message, or its other fields reach the log.
  it("sends an unexpected error as a 500 and logs only its message and stack", async () => {
    const res = await app.inject({ method: "GET", url: "/api/boom", headers: { host: "localhost" } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: "device_error", message: "Something went wrong on the server." });
    const errLines = logged().filter((line) => "err" in line);
    expect(errLines).toHaveLength(1);
    // pino's err serializer adds `type`.
    expect(errLines[0]?.err).toEqual({ type: "Object", message: "boom", stack: expect.stringContaining("boom") });
  });

  // Fails if bad JSON gets Fastify's own error body, or the client error is logged.
  it("answers bad JSON with invalid_request and does not log it", async () => {
    const res = await post('{"pin":"12');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_request", message: "That request isn't valid." });
    expect(logLines.length).toBeGreaterThan(0);
    expect(logLines.join("")).not.toContain("pin");
    expect(logged().filter((line) => "err" in line)).toEqual([]);
  });

  // Fails if an oversized body gets Fastify's own error body instead of invalid_request.
  it("answers a 40 KB body with 413 invalid_request", async () => {
    const res = await post(JSON.stringify({ v: "a".repeat(40 * 1024) }));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toEqual({ error: "invalid_request", message: "That request isn't valid." });
  });
});

describe("messages", () => {
  // Fails if the device_offline text drifts from the design's mock.
  it("names the device in deviceOffline", () => {
    expect(messages.deviceOffline("Backyard")).toBe("Backyard isn't responding.");
  });
});
