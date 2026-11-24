import type { FastifyInstance } from "fastify";
import type { LightsPatch, LightsView, StrandPatch } from "../../shared/apiTypes";
import type { ServerDeps } from "../app";
import { ApiError, messages } from "../errors";
import * as strandGroups from "../db/strandGroups";
import { clearLeftovers, deviceError, flashLed, readDeviceLights, setDevicePower, writeLayout } from "../lights/deviceLights";
import { LayoutError, splitShared, writeStrand } from "../lights/layoutWrite";
import { loadDevice } from "./settings";

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
  properties: { strandKey: { type: "string", pattern: "^o\\d+(\\+o\\d+)*$" }, led: { type: "integer", minimum: 0 } },
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
    async (request): Promise<LightsView> => {
      const row = loadDevice(deps, request.params.id);
      const d = await clearLeftovers(deps, await readDeviceLights(deps, row));
      const strand = d.strands.find((s) => s.key === request.params.key);
      if (!strand) throw new ApiError(409, "strand_changed", messages.strandChanged());
      try {
        const write = writeStrand(d.state, strand, request.body, d.lists, d.paint, d.view.segments.max);
        return (await writeLayout(deps, d, write)).view;
      } catch (err) {
        throw err instanceof LayoutError ? deviceError(err, strand.name) : err;
      }
    },
  );

  app.post<{ Params: { id: string; key: string }; Body: { action: "split" | "combine" } }>(
    "/api/devices/:id/lights/strands/:key/resolve",
    { schema: { body: resolveBody } },
    async (request): Promise<LightsView> => {
      const row = loadDevice(deps, request.params.id);
      const read = await readDeviceLights(deps, row);
      const strand = read.strands.find((s) => s.key === request.params.key);
      const shared = read.view.strands.find((s) => s.key === request.params.key)?.shared;
      if (!strand) throw new ApiError(409, "strand_changed", messages.strandChanged());
      if (!shared) return read.view;
      const touched = [strand, ...read.strands.filter((s) => shared.with.includes(s.key))].sort((a, b) => a.start - b.start);
      if (request.body.action === "combine") {
        const members = new Set(touched.flatMap((s) => s.members));
        const kept = strandGroups.list(deps.db, row.id).filter((k) => !read.dropped.includes(k) && !k.split("+").some((m) => members.has(m)));
        strandGroups.replace(deps.db, row.id, [...kept, touched.flatMap((s) => s.members).join("+")]);
        return (await readDeviceLights(deps, row)).view;
      }
      const d = await clearLeftovers(deps, read);
      try {
        return (await writeLayout(deps, d, splitShared(d.state, touched, d.view.segments.max))).view;
      } catch (err) {
        throw err instanceof LayoutError ? deviceError(err, strand.name) : err;
      }
    },
  );
}
