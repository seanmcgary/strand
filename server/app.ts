import type { DatabaseSync } from "node:sqlite";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { Config } from "./config";
import { isApiRequest, registerRequestGuard } from "./requestGuard";
import { serializeRequestForLog } from "./requestLogSerializer";

/** Everything `buildApp` needs. Tests replace mDNS, the clock and the database. */
export interface AppDeps {
  config: Config;
  db: DatabaseSync;
  mdns: {
    browseWled(windowMs: number): Promise<{ host: string; port: number; addresses: string[] }[]>;
    resolveA(host: string, timeoutMs: number): Promise<string | null>;
  };
  now: () => Date;
  /** The port of WLED devices: 80 in production. */
  wledPort: number;
  /** The wait between starting a Wi-Fi scan and reading it: 1000 in production. */
  scanDelayMs: number;
}

/**
 * Builds the server: the `/api` guard, the API routes, the built frontend,
 * and `index.html` for every other GET so that browser routes load the app.
 * Sync on purpose: tests use the returned app without awaiting.
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const { config } = deps;
  const app = Fastify({
    logger: { serializers: { req: serializeRequestForLog } },
    bodyLimit: 32768,
  });

  // `/api` takes JSON bodies only.
  app.removeContentTypeParser("text/plain");

  app.addHook("onRequest", async (request, reply) => {
    if (isApiRequest(request)) reply.header("cache-control", "no-store");
  });
  registerRequestGuard(app, config);

  app.register(fastifyStatic, {
    root: config.webDistDir,
    // "/" and browser routes reach the not-found handler, which sends index.html.
    index: false,
    wildcard: false,
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (isApiRequest(request) || (request.method !== "GET" && request.method !== "HEAD")) {
      return reply.code(404).send({ error: "not_found", message: "That page doesn't exist." });
    }
    return reply.sendFile("index.html");
  });

  return app;
}
