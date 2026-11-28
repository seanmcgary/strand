import type { FastifyInstance } from "fastify";
import type { LightsPatch, LightsView, StrandPatch } from "../../shared/apiTypes";
import { NAME_CHARS } from "../../shared/segmentName";
import type { ServerDeps } from "../app";
import { ApiError, messages } from "../errors";
import * as preferences from "../db/preferences";
import * as strandGroups from "../db/strandGroups";
import { clearLeftovers, deviceError, flashLed, namesOf, readDeviceLights, refuseMatrix, setDevicePower, writeLayout } from "../lights/deviceLights";
import { cutRanges, LayoutError, splitShared, writeStrand } from "../lights/layoutWrite";
import { loadDevice } from "./settings";

/** A strand key: one output (`o0`) or touching outputs joined with `+` (`o0+o1`). */
export const STRAND_KEY = "^o\\d+(\\+o\\d+)*$";

const lightsPatchBody = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: { on: { type: "boolean" }, bri: { type: "integer", minimum: 0, maximum: 255 } },
} as const;

const flashBody = {
  type: "object",
  required: ["strandKey", "led"],
  additionalProperties: false,
  properties: { strandKey: { type: "string", pattern: STRAND_KEY }, led: { type: "integer", minimum: 0 } },
} as const;

const int = { type: "integer" } as const;
const slotSchema = {
  type: "object",
  required: ["on", "col", "fx", "fxName", "sx", "ix", "c1", "c2", "c3", "o1", "o2", "o3", "pal", "palName"],
  additionalProperties: false,
  properties: {
    on: { type: "boolean" },
    col: { type: "array", maxItems: 3, items: { type: "array", maxItems: 4, items: int } },
    fx: int,
    fxName: { type: "string", maxLength: 256 },
    sx: int,
    ix: int,
    c1: int,
    c2: int,
    c3: int,
    o1: { type: "boolean" },
    o2: { type: "boolean" },
    o3: { type: "boolean" },
    pal: int,
    palName: { type: "string", maxLength: 256 },
  },
} as const;
const patternSchema = {
  anyOf: [
    { type: "object", required: ["kind"], additionalProperties: false, properties: { kind: { const: "all" } } },
    { type: "object", required: ["kind"], additionalProperties: false, properties: { kind: { const: "individual" } } },
    { type: "object", required: ["kind", "n", "group"], additionalProperties: false, properties: { kind: { const: "every" }, n: int, group: int } },
  ],
} as const;
const rangeSchema = {
  type: "object",
  required: ["name", "start", "len", "pattern", "slots"],
  additionalProperties: false,
  properties: {
    name: { type: "string", maxLength: 256 },
    start: int,
    len: int,
    pattern: patternSchema,
    slots: { type: "array", maxItems: 256, items: slotSchema },
    paint: { type: "array", maxItems: 65536, items: { type: "string", maxLength: 7 } },
  },
} as const;
const strandPatchBody = {
  type: "object",
  minProperties: 1,
  additionalProperties: false,
  properties: {
    on: { type: "boolean" },
    bri: { type: "integer", minimum: 1, maximum: 255 },
    ranges: { type: "array", maxItems: 256, items: rangeSchema },
  },
} as const;
const resolveBody = {
  type: "object",
  required: ["action"],
  additionalProperties: false,
  properties: { action: { enum: ["split", "combine"] } },
} as const;

const groupsBody = {
  type: "object",
  required: ["keys"],
  additionalProperties: false,
  properties: { keys: { type: "array", maxItems: 64, items: { type: "string", pattern: "^o\\d+(\\+o\\d+)+$" } } },
} as const;
const namesBody = {
  type: "object",
  required: ["names"],
  additionalProperties: false,
  properties: {
    names: {
      type: "object",
      maxProperties: 64,
      propertyNames: { pattern: STRAND_KEY },
      additionalProperties: { type: "string", maxLength: 1024 },
    },
  },
} as const;

export async function lightsRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  app.get<{ Params: { id: string } }>(
    "/api/devices/:id/lights",
    async (request): Promise<LightsView> => (await readDeviceLights(deps, loadDevice(deps, request.params.id))).view,
  );

  app.patch<{ Params: { id: string }; Body: LightsPatch }>(
    "/api/devices/:id/lights",
    { schema: { body: lightsPatchBody } },
    async (request): Promise<LightsView> => {
      const row = loadDevice(deps, request.params.id);
      await clearLeftovers(deps, await readDeviceLights(deps, row));
      await setDevicePower(deps, row, request.body);
      return (await readDeviceLights(deps, row)).view;
    },
  );

  app.post<{ Params: { id: string }; Body: { strandKey: string; led: number } }>(
    "/api/devices/:id/lights/flash",
    { schema: { body: flashBody } },
    async (request, reply) => {
      const d = await readDeviceLights(deps, loadDevice(deps, request.params.id));
      refuseMatrix(d);
      const strand = d.strands.find((s) => s.key === request.body.strandKey);
      if (!strand) throw new ApiError(409, "strand_changed", messages.strandChanged());
      if (request.body.led >= strand.len) throw new ApiError(400, "invalid_request", messages.invalidRequest());
      await flashLed(deps, d, strand.start + request.body.led);
      return reply.code(204).send();
    },
  );

  app.patch<{ Params: { id: string; key: string }; Body: StrandPatch }>(
    "/api/devices/:id/lights/strands/:key",
    { schema: { body: strandPatchBody }, bodyLimit: 262144 },
    async (request): Promise<LightsView> =>
      writeLayout(deps, loadDevice(deps, request.params.id), async (d, send) => {
        const strand = d.strands.find((s) => s.key === request.params.key);
        if (!strand) throw new ApiError(409, "strand_changed", messages.strandChanged());
        try {
          return (await send(writeStrand(d.state, strand, request.body, d.lists, d.paint, d.view.segments.max))).view;
        } catch (err) {
          throw err instanceof LayoutError ? deviceError(err, strand.name) : err;
        }
      }),
  );

  app.post<{ Params: { id: string; key: string }; Body: { action: "split" | "combine" } }>(
    "/api/devices/:id/lights/strands/:key/resolve",
    { schema: { body: resolveBody } },
    async (request): Promise<LightsView> => {
      const row = loadDevice(deps, request.params.id);
      return writeLayout(deps, row, async (d, send) => {
        const strand = d.strands.find((s) => s.key === request.params.key);
        const shared = d.view.strands.find((s) => s.key === request.params.key)?.shared;
        if (!strand) throw new ApiError(409, "strand_changed", messages.strandChanged());
        if (!shared) return d.view;
        const touched = [strand, ...d.strands.filter((s) => shared.with.includes(s.key))].sort((a, b) => a.start - b.start);
        if (request.body.action === "combine") {
          const members = new Set(touched.flatMap((s) => s.members));
          const kept = strandGroups.list(deps.db, row.id).filter((k) => !k.split("+").some((m) => members.has(m)));
          strandGroups.replace(deps.db, row.id, [...kept, touched.flatMap((s) => s.members).join("+")]);
          return (await readDeviceLights(deps, row)).view;
        }
        try {
          return (await send(splitShared(d.state, touched, d.view.segments.max))).view;
        } catch (err) {
          throw err instanceof LayoutError ? deviceError(err, strand.name) : err;
        }
      });
    },
  );

  app.get<{ Params: { id: string } }>("/api/devices/:id/strand-groups", async (request): Promise<string[]> =>
    strandGroups.list(deps.db, loadDevice(deps, request.params.id).id),
  );

  app.put<{ Params: { id: string }; Body: { keys: string[] } }>(
    "/api/devices/:id/strand-groups",
    { schema: { body: groupsBody } },
    async (request): Promise<LightsView> => {
      const row = loadDevice(deps, request.params.id);
      const { keys } = request.body;
      return writeLayout(deps, row, async (first, send) => {
        let d = first;
        if (keys.length > d.outputs.length) throw new ApiError(400, "invalid_request", messages.invalidRequest());
        const used = new Set<string>();
        for (const key of keys) {
          const outs = key.split("+").map((m) => d.outputs[Number(m.slice(1))]);
          const touching = outs.every((o, k) => o !== undefined && (k === 0 || outs[k - 1]!.start + outs[k - 1]!.len === o.start));
          const fresh = key.split("+").every((m) => !used.has(m));
          if (!touching || !fresh) throw new ApiError(422, "not_adjacent", messages.notAdjacent());
          key.split("+").forEach((m) => used.add(m));
        }
        // A group that goes away is cut where its outputs meet, before the groups change.
        const removed = d.strands.filter((s) => s.members.length > 1 && !keys.includes(s.key)).map((s) => s.key);
        for (const key of removed) {
          const strand = d.strands.find((s) => s.key === key)!;
          const ranges = d.view.strands.find((v) => v.key === key)!.ranges;
          const cut = cutRanges(ranges, strand.members.slice(1).map((m) => d.outputs[Number(m.slice(1))]!.start - strand.start));
          if (cut.length === ranges.length) continue;
          try {
            d = await send(writeStrand(d.state, strand, { ranges: cut }, d.lists, d.paint, d.view.segments.max, { sharedNames: true }));
          } catch (err) {
            throw err instanceof LayoutError ? deviceError(err, strand.name) : err;
          }
        }
        strandGroups.replace(deps.db, row.id, keys);
        return (await readDeviceLights(deps, row)).view;
      });
    },
  );

  app.put<{ Params: { id: string }; Body: { names: Record<string, string> } }>(
    "/api/devices/:id/strand-names",
    { schema: { body: namesBody } },
    async (request): Promise<LightsView> => {
      const row = loadDevice(deps, request.params.id);
      const d = await readDeviceLights(deps, row);
      refuseMatrix(d);
      const current = new Set(d.strands.map((s) => s.key));
      const given = Object.entries(request.body.names);
      if (given.some(([key]) => !current.has(key))) throw new ApiError(409, "strand_changed", messages.strandChanged());
      const stored = namesOf(preferences.get(deps.db, `strandNames.${row.id}`));
      for (const [key, value] of given) {
        const name = value.trim();
        if ([...name].length > NAME_CHARS) throw new ApiError(422, "invalid_name", messages.invalidName());
        if (name === "") delete stored[key];
        else stored[key] = name;
      }
      if (Object.keys(stored).length === 0) preferences.remove(deps.db, `strandNames.${row.id}`);
      else preferences.put(deps.db, `strandNames.${row.id}`, stored, deps.now());
      return (await readDeviceLights(deps, row)).view;
    },
  );
}
