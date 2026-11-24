import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, type Config } from "./config";
import { registerRequestGuard } from "./requestGuard";

const apps: ReturnType<typeof Fastify>[] = [];

function guarded(allowedHosts: Config["allowedHosts"] = []) {
  const app = Fastify();
  registerRequestGuard(app, { ...loadConfig({}), allowedHosts });
  app.get("/api/x", async () => ({ ok: true }));
  app.post("/api/x", async () => ({ ok: true }));
  app.get("/", async () => "page");
  apps.push(app);
  return app;
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("registerRequestGuard: Host", () => {
  // Fails if IP addresses, localhost or .local names stop being allowed by default.
  it.each(["192.168.1.10:3000", "localhost:3000", "strand.local"])("allows %s", async (host) => {
    const res = await guarded().inject({ method: "GET", url: "/api/x", headers: { host } });
    expect(res.statusCode).toBe(200);
  });

  // Fails if the guard lets an unknown host (DNS rebinding) reach /api.
  it("rejects an unknown host", async () => {
    const res = await guarded().inject({ method: "GET", url: "/api/x", headers: { host: "evil.example.com" } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });

  // Fails if ALLOWED_HOSTS names are not consulted.
  it("allows a host from the allow-list", async () => {
    const res = await guarded(["evil.example.com"]).inject({ method: "GET", url: "/api/x", headers: { host: "evil.example.com" } });
    expect(res.statusCode).toBe(200);
  });

  // Fails if "*" does not turn the Host check off.
  it("allows any host with *", async () => {
    const res = await guarded("*").inject({ method: "GET", url: "/api/x", headers: { host: "evil.example.com" } });
    expect(res.statusCode).toBe(200);
  });

  // Fails if the guard checks the raw URL, which the router decodes after it.
  it("guards an encoded /api path", async () => {
    const res = await guarded().inject({ method: "GET", url: "/%61pi/x", headers: { host: "evil.example.com" } });
    expect(res.statusCode).toBe(403);
  });

  // Fails if the guard reaches outside /api.
  it("does not guard pages", async () => {
    const res = await guarded().inject({ method: "GET", url: "/", headers: { host: "evil.example.com" } });
    expect(res.statusCode).toBe(200);
  });
});

describe("registerRequestGuard: writes", () => {
  const post = (headers: Record<string, string>) =>
    guarded().inject({ method: "POST", url: "/api/x", headers: { host: "localhost:3000", ...headers } });

  // Fails if a cross-site form POST (no custom header) is accepted.
  it("rejects a write without X-Strand-Request", async () => {
    expect((await post({})).statusCode).toBe(403);
  });

  // Fails if a same-origin write from the app is rejected.
  it("allows a write with X-Strand-Request", async () => {
    expect((await post({ "x-strand-request": "1" })).statusCode).toBe(200);
  });

  // Fails if the Origin is not compared with the Host.
  it("rejects a write from another origin", async () => {
    expect((await post({ "x-strand-request": "1", origin: "http://evil.example.com" })).statusCode).toBe(403);
  });

  // Fails if a matching Origin is rejected.
  it("allows a write from the same origin", async () => {
    expect((await post({ "x-strand-request": "1", origin: "http://localhost:3000" })).statusCode).toBe(200);
  });
});
