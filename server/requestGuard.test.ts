import { connect, type AddressInfo } from "node:net";
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
  // Fails if IP addresses (v4 and bracketed v6), localhost or .local names stop being allowed by default.
  it.each(["192.168.1.10:3000", "[::1]:3000", "localhost:3000", "strand.local"])("allows %s", async (host) => {
    const res = await guarded().inject({ method: "GET", url: "/api/x", headers: { host } });
    expect(res.statusCode).toBe(200);
  });

  // Fails if the guard lets an unknown host (DNS rebinding) reach /api.
  it("rejects an unknown host", async () => {
    const res = await guarded().inject({ method: "GET", url: "/api/x", headers: { host: "evil.example.com" } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });

  // Fails if a request with no Host header is let through instead of rejected.
  it("rejects a missing host", async () => {
    // inject() always fills in a Host, so send a raw HTTP/1.0 request, which may omit it.
    const app = guarded();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const reply = await new Promise<string>((resolve, reject) => {
      let data = "";
      const socket = connect(port, "127.0.0.1", () => socket.end("GET /api/x HTTP/1.0\r\n\r\n"));
      socket.on("data", (chunk) => (data += chunk));
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
    });
    expect(reply.split("\r\n")[0]).toMatch(/^HTTP\/1\.[01] 403 /);
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

  // Fails if HEAD is treated as a write and needs X-Strand-Request.
  it("treats HEAD as a read", async () => {
    const res = await guarded().inject({ method: "HEAD", url: "/api/x", headers: { host: "localhost:3000" } });
    expect(res.statusCode).toBe(200);
  });

  // Fails if an opaque `Origin: null` (sandboxed frame, file://) is accepted.
  it("rejects a write with Origin null", async () => {
    expect((await post({ "x-strand-request": "1", origin: "null" })).statusCode).toBe(403);
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
