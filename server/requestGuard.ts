import { isIP } from "node:net";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Config } from "./config";

/**
 * True for a request to `/api` or a path under it. Reads the matched route's
 * pattern when there is one, because the router decodes the path first:
 * `/%61pi/x` and `/./api/x` reach the route `/api/x`.
 */
export function isApiRequest(request: FastifyRequest): boolean {
  const path = (request.routeOptions.url ?? request.url).split("?")[0] ?? "";
  return path === "/api" || path.startsWith("/api/");
}

/** Splits a Host header value into a lowercase host name and a port ("" when absent). */
function parseHost(value: string): { name: string; port: string } | null {
  const match = /^(\[[0-9a-f:.]+\]|[^:[\]]+)(?::(\d+))?$/i.exec(value.trim());
  if (!match?.[1]) return null;
  return { name: match[1].toLowerCase(), port: match[2] ?? "" };
}

function hostAllowed(name: string, allowedHosts: Config["allowedHosts"]): boolean {
  if (allowedHosts === "*") return true;
  const bare = name.startsWith("[") ? name.slice(1, -1) : name;
  return isIP(bare) !== 0 || bare === "localhost" || bare.endsWith(".local") || allowedHosts.includes(bare);
}

/** True when the Origin header names the same host and port as the Host header. */
function sameOrigin(origin: string, host: { name: string; port: string }): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const defaultPort = url.protocol === "https:" ? "443" : url.protocol === "http:" ? "80" : null;
  if (defaultPort === null) return false;
  return url.hostname.toLowerCase() === host.name && (url.port || defaultPort) === (host.port || defaultPort);
}

function allowed(request: FastifyRequest, config: Config): boolean {
  const host = parseHost(request.headers.host ?? "");
  if (!host || !hostAllowed(host.name, config.allowedHosts)) return false;
  if (request.method === "GET" || request.method === "HEAD") return true;
  if (request.headers["x-strand-request"] !== "1") return false;
  const origin = request.headers.origin;
  return origin === undefined || sameOrigin(origin, host);
}

/**
 * Host allow-list and CSRF guard for `/api`. The app has no login, so this
 * keeps a web page on another site from using the API through the user's
 * browser:
 *
 * - DNS rebinding: an `/api` request whose Host is not an IP address,
 *   `localhost`, a `.local` name or in `config.allowedHosts` is rejected.
 * - Cross-site writes: a request other than GET/HEAD needs the header
 *   `X-Strand-Request: 1` (a cross-site form cannot set it, and a cross-site
 *   fetch that sets it needs a CORS preflight this server never grants), and
 *   an `Origin`, when sent, must name the Host.
 *
 * A reverse proxy with its own host name must be listed in `ALLOWED_HOSTS`.
 */
export function registerRequestGuard(app: FastifyInstance, config: Config): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!isApiRequest(request) || allowed(request, config)) return;
    return reply.code(403).send({ error: "invalid_request", message: "That request isn't valid." });
  });
}
