import type { DatabaseSync } from "node:sqlite";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import fastifyStatic from "@fastify/static";
import type { Config } from "./config";
import type { browseWled, resolveA } from "./mdns";
import { ApiError, registerErrorHandler } from "./errors";
import { controlRoutes } from "./routes/control";
import { devicesRoutes } from "./routes/devices";
import { discoveryRoutes } from "./routes/discovery";
import { lightsRoutes } from "./routes/lights";
import { presetsRoutes } from "./routes/presets";
import { preferencesRoutes } from "./routes/preferences";
import { settingsRoutes } from "./routes/settings";
import { isApiRequest, registerRequestGuard } from "./requestGuard";
import { serializeRequestForLog } from "./requestLogSerializer";
import { createLightsRuntime, type LightsRuntime } from "./lights/runtime";

/** Everything `buildApp` needs. Tests replace mDNS, the clock and the database. */
export interface AppDeps {
  config: Config;
  db: DatabaseSync;
  mdns: { browseWled: typeof browseWled; resolveA: typeof resolveA };
  now: () => Date;
  /** The port of WLED devices: 80 in production. */
  wledPort: number;
  /** The wait between starting a Wi-Fi scan and reading it: 1000 in production. */
  scanDelayMs: number;
  /**
   * Fastify's logger option. Defaults to request logs on stdout. Tests pass
   * `false`, or `{ stream }` to read the log back. The request serializer is
   * always applied.
   */
  logger?: FastifyServerOptions["logger"];
  /** How long a flash LED stays lit (spec §6.6). Defaults to 3000. */
  flashMs?: number;
  /** The wait after the last Lights write before the startup preset is saved (spec §6.7). Defaults to 5000. */
  startupDelayMs?: number;
}

/** What every route plugin gets: the dependencies with their defaults, and the lights runtime. */
export type ServerDeps = AppDeps & { flashMs: number; startupDelayMs: number; lights: LightsRuntime };

/**
 * Builds the server: the `/api` guard, the API routes, the built frontend,
 * and `index.html` for every other GET so that browser routes load the app.
 * Sync on purpose: tests use the returned app without awaiting.
 */
export function buildApp(appDeps: AppDeps): FastifyInstance {
  const { config } = appDeps;
  const app = Fastify({
    logger:
      appDeps.logger === false
        ? false
        : { ...(typeof appDeps.logger === "object" ? appDeps.logger : {}), serializers: { req: serializeRequestForLog } },
    bodyLimit: 32768,
    // Fastify's default Ajv coerces types and strips unknown properties, so a
    // schema alone would accept `{ host: 5 }` and `{ host, extra }`.
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });

  const timing = { flashMs: appDeps.flashMs ?? 3000, startupDelayMs: appDeps.startupDelayMs ?? 5000 };
  const deps: ServerDeps = { ...appDeps, ...timing, lights: createLightsRuntime({ ...appDeps, ...timing }, app.log) };
  app.addHook("onClose", async () => deps.lights.close());

  // `/api` takes JSON bodies only.
  app.removeContentTypeParser("text/plain");

  app.addHook("onRequest", async (request, reply) => {
    if (isApiRequest(request)) reply.header("cache-control", "no-store");
  });
  registerRequestGuard(app, config);
  registerErrorHandler(app);

  app.register(devicesRoutes, deps);
  app.register(discoveryRoutes, deps);
  app.register(settingsRoutes, deps);
  app.register(controlRoutes, deps);
  app.register(lightsRoutes, deps);
  app.register(presetsRoutes, deps);
  app.register(preferencesRoutes, deps);

  app.register(fastifyStatic, {
    root: config.webDistDir,
    // "/" and browser routes reach the not-found handler, which sends index.html.
    index: false,
    wildcard: false,
  });

  app.setNotFoundHandler(async (request, reply) => {
    if (isApiRequest(request) || (request.method !== "GET" && request.method !== "HEAD")) {
      throw new ApiError(404, "not_found", "That page doesn't exist.");
    }
    return reply.sendFile("index.html");
  });

  return app;
}
