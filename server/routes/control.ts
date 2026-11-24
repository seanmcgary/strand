import type { FastifyInstance } from "fastify";
import type { Effect, Palette, StatePatch } from "../../shared/apiTypes";
import type { AppDeps } from "../app";
import { ApiError, messages } from "../errors";
import { deviceRequest } from "../wled/deviceClient";
import { palxStops, parseEffectMeta } from "../wled/effectMeta";
import { targetOf } from "./devices";
import { loadDevice } from "./settings";

const statePatchBody = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: { on: { type: "boolean" }, bri: { type: "integer", minimum: 0, maximum: 255 } },
} as const;

/** The name WLED gives to an effect slot that no effect uses. */
const RESERVED_EFFECT = "RSVD";

export async function controlRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/devices/:id/state", async (request) =>
    deviceRequest<Record<string, unknown>>(deps, targetOf(loadDevice(deps, request.params.id)), "/json/state"),
  );

  app.patch<{ Params: { id: string }; Body: StatePatch }>(
    "/api/devices/:id/state",
    { schema: { body: statePatchBody } },
    async (request) =>
      // `v` makes the device answer with its full state.
      deviceRequest<Record<string, unknown>>(deps, targetOf(loadDevice(deps, request.params.id)), "/json/state", {
        method: "POST",
        body: { ...request.body, v: true },
      }),
  );

  app.get<{ Params: { id: string } }>("/api/devices/:id/effects", async (request): Promise<Effect[]> => {
    const target = targetOf(loadDevice(deps, request.params.id));
    const names = await deviceRequest<string[]>(deps, target, "/json/effects");
    const fxdata = await deviceRequest<string[]>(deps, target, "/json/fxdata");
    if (!Array.isArray(names) || !Array.isArray(fxdata)) {
      throw new ApiError(502, "device_error", messages.deviceError(target.name, "the reply is not valid"));
    }
    return names
    .map((name, id) => ({ id, name, ...parseEffectMeta(id, fxdata[id] ?? "") }))
    .filter((effect) => effect.name !== RESERVED_EFFECT);
  });

  app.get<{ Params: { id: string } }>("/api/devices/:id/palettes", async (request): Promise<Palette[]> => {
    const target = targetOf(loadDevice(deps, request.params.id));
    const names = await deviceRequest<string[]>(deps, target, "/json/palettes");
    if (!Array.isArray(names)) {
      throw new ApiError(502, "device_error", messages.deviceError(target.name, "the reply is not valid"));
    }
    const stops = new Map<number, string[]>();
    let last = 0;
    // Pages are read one after another; `m` is the last page index.
    for (let page = 0; page <= last; page++) {
      const reply = await deviceRequest<{ m?: unknown; p?: unknown }>(deps, target, `/json/palx?page=${page}`);
      if (typeof reply.p !== "object" || reply.p === null) {
        throw new ApiError(502, "device_error", messages.deviceError(target.name, "the reply is not valid"));
      }
      if (Number.isInteger(reply.m) && (reply.m as number) > last) last = Math.min(reply.m as number, 64);
      for (const [key, entries] of Object.entries(reply.p)) {
        stops.set(Number(key), Array.isArray(entries) ? palxStops(entries) : []);
      }
    }
    return names.map((name, id) => ({ id, name, stops: stops.get(id) ?? [] }));
  });
}
