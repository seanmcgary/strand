import type { FastifyInstance } from "fastify";
import type { ApplyResult, LookRecord, LookTarget, Scene } from "../../shared/apiTypes";
import { briToPct } from "../../shared/brightness";
import { NAME_CHARS } from "../../shared/segmentName";
import type { ServerDeps } from "../app";
import * as looks from "../db/looks";
import * as scenes from "../db/scenes";
import { ApiError, messages } from "../errors";
import { deviceError, readDeviceLights, refuseMatrix, writeLayout } from "../lights/deviceLights";
import { LayoutError, segmentsNeeded, writeStrand } from "../lights/layoutWrite";
import { lookFromRange, lookToPatches, sceneToPatch, snapshotStrand } from "../lights/snapshots";
import { STRAND_KEY } from "./lights";
import { loadDevice } from "./settings";

const MAX_SCENES = 256;
const MAX_LOOKS = 256;
const MAX_CONTENT_BYTES = 65536;
const MAX_TARGETS = 64;

const nameProp = { type: "string", maxLength: 1024 } as const;
const saveBody = {
  type: "object",
  required: ["name", "strandKey"],
  additionalProperties: false,
  properties: { name: nameProp, strandKey: { type: "string", pattern: STRAND_KEY } },
} as const;
const renameBody = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: nameProp },
} as const;

const lookBody = {
  type: "object",
  required: ["name", "strandKey", "range"],
  additionalProperties: false,
  properties: { name: nameProp, strandKey: { type: "string", pattern: STRAND_KEY }, range: { type: "string", maxLength: 64 } },
} as const;
const applyLookBody = {
  type: "object",
  required: ["targets"],
  additionalProperties: false,
  properties: {
    targets: {
      type: "array",
      minItems: 1,
      maxItems: MAX_TARGETS,
      items: {
        type: "object",
        required: ["strandKey"],
        additionalProperties: false,
        properties: { strandKey: { type: "string", pattern: STRAND_KEY }, range: { type: "string", maxLength: 64 } },
      },
    },
  },
} as const;

/** The trimmed name, or `422 invalid_name`. */
function checkedName(name: string): string {
  const trimmed = name.trim();
  const chars = [...trimmed].length;
  if (chars < 1 || chars > NAME_CHARS) throw new ApiError(422, "invalid_name", messages.invalidName());
  return trimmed;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

function toScene(row: scenes.SceneRow): Scene {
  const { on, bri, ranges } = row.content;
  return {
    id: row.id,
    name: row.name,
    strandKey: row.strandKey,
    ledCount: row.ledCount,
    summary: `${plural(ranges.length, "range")} · ${on ? `${briToPct(bri)}%` : "off"}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toLookRecord(row: looks.LookRow): LookRecord {
  return { id: row.id, name: row.name, look: row.look, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function presetsRoutes(app: FastifyInstance, deps: ServerDeps): Promise<void> {
  const sceneOf = (deviceId: string, id: string): scenes.SceneRow => {
    const row = scenes.get(deps.db, deviceId, id);
    if (!row) throw new ApiError(404, "not_found", messages.sceneGone());
    return row;
  };

  app.get<{ Params: { id: string } }>("/api/devices/:id/scenes", async (request): Promise<Scene[]> =>
    scenes.list(deps.db, loadDevice(deps, request.params.id).id).map(toScene),
  );

  app.post<{ Params: { id: string }; Body: { name: string; strandKey: string } }>(
    "/api/devices/:id/scenes",
    { schema: { body: saveBody } },
    async (request, reply): Promise<Scene> => {
      const row = loadDevice(deps, request.params.id);
      const name = checkedName(request.body.name);
      const d = await readDeviceLights(deps, row);
      refuseMatrix(d);
      const view = d.view.strands.find((s) => s.key === request.body.strandKey);
      if (!view) throw new ApiError(409, "strand_changed", messages.strandChanged());
      const content = snapshotStrand(view);
      if (Buffer.byteLength(JSON.stringify(content)) > MAX_CONTENT_BYTES) throw new ApiError(422, "invalid_layout", messages.contentTooLarge());
      // No await between the count and the insert, so saves sent together cannot pass the cap together.
      if (scenes.count(deps.db, row.id) >= MAX_SCENES) throw new ApiError(422, "too_many", messages.tooManyScenes(MAX_SCENES));
      const saved = scenes.insert(deps.db, { deviceId: row.id, name, strandKey: view.key, ledCount: view.len, content }, deps.now());
      return reply.code(201).send(toScene(saved));
    },
  );

  app.patch<{ Params: { id: string; sceneId: string }; Body: { name: string } }>(
    "/api/devices/:id/scenes/:sceneId",
    { schema: { body: renameBody } },
    async (request): Promise<Scene> => {
      const row = loadDevice(deps, request.params.id);
      const name = checkedName(request.body.name);
      const renamed = scenes.rename(deps.db, row.id, request.params.sceneId, name, deps.now());
      if (!renamed) throw new ApiError(404, "not_found", messages.sceneGone());
      return toScene(renamed);
    },
  );

  app.delete<{ Params: { id: string; sceneId: string } }>("/api/devices/:id/scenes/:sceneId", async (request, reply) => {
    scenes.remove(deps.db, loadDevice(deps, request.params.id).id, request.params.sceneId);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string; sceneId: string } }>(
    "/api/devices/:id/scenes/:sceneId/apply",
    async (request): Promise<ApplyResult> => {
      const row = loadDevice(deps, request.params.id);
      const scene = sceneOf(row.id, request.params.sceneId);
      return writeLayout(deps, row, async (d, send) => {
        const strand = d.strands.find((s) => s.key === scene.strandKey);
        const view = d.view.strands.find((s) => s.key === scene.strandKey);
        if (!strand || !view) throw new ApiError(409, "strand_changed", messages.strandChanged());
        if (view.shared) throw new ApiError(409, "shared", messages.shared(view.name));
        try {
          const { next, warnings } = sceneToPatch(scene.content, scene.ledCount, strand, d.lists);
          return { view: (await send(writeStrand(d.state, strand, next, d.lists, d.paint, d.view.segments.max))).view, warnings };
        } catch (err) {
          throw err instanceof LayoutError ? deviceError(err, strand.name) : err;
        }
      });
    },
  );

  const lookOf = (deviceId: string, id: string): looks.LookRow => {
    const row = looks.get(deps.db, deviceId, id);
    if (!row) throw new ApiError(404, "not_found", messages.lookGone());
    return row;
  };

  app.get<{ Params: { id: string } }>("/api/devices/:id/looks", async (request): Promise<LookRecord[]> =>
    looks.list(deps.db, loadDevice(deps, request.params.id).id).map(toLookRecord),
  );

  app.post<{ Params: { id: string }; Body: { name: string; strandKey: string; range: string } }>(
    "/api/devices/:id/looks",
    { schema: { body: lookBody } },
    async (request, reply): Promise<LookRecord> => {
      const row = loadDevice(deps, request.params.id);
      const name = checkedName(request.body.name);
      const d = await readDeviceLights(deps, row);
      refuseMatrix(d);
      const view = d.view.strands.find((s) => s.key === request.body.strandKey);
      if (!view) throw new ApiError(409, "strand_changed", messages.strandChanged());
      const range = view.ranges.find((r) => r.name === request.body.range);
      if (!range) throw new ApiError(404, "not_found", messages.rangeGone());
      // No await between the count and the insert, so saves sent together cannot pass the cap together.
      if (looks.count(deps.db, row.id) >= MAX_LOOKS) throw new ApiError(422, "too_many", messages.tooManyLooks(MAX_LOOKS));
      try {
        const saved = looks.insert(deps.db, { deviceId: row.id, name, look: lookFromRange(range) }, deps.now());
        return reply.code(201).send(toLookRecord(saved));
      } catch (err) {
        throw err instanceof LayoutError ? deviceError(err, view.name) : err;
      }
    },
  );

  app.patch<{ Params: { id: string; lookId: string }; Body: { name: string } }>(
    "/api/devices/:id/looks/:lookId",
    { schema: { body: renameBody } },
    async (request): Promise<LookRecord> => {
      const row = loadDevice(deps, request.params.id);
      const name = checkedName(request.body.name);
      const renamed = looks.rename(deps.db, row.id, request.params.lookId, name, deps.now());
      if (!renamed) throw new ApiError(404, "not_found", messages.lookGone());
      return toLookRecord(renamed);
    },
  );

  app.delete<{ Params: { id: string; lookId: string } }>("/api/devices/:id/looks/:lookId", async (request, reply) => {
    looks.remove(deps.db, loadDevice(deps, request.params.id).id, request.params.lookId);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string; lookId: string }; Body: { targets: LookTarget[] } }>(
    "/api/devices/:id/looks/:lookId/apply",
    { schema: { body: applyLookBody } },
    async (request): Promise<ApplyResult> => {
      const row = loadDevice(deps, request.params.id);
      const { look } = lookOf(row.id, request.params.lookId);
      return writeLayout(deps, row, async (first, send) => {
        let d = first;
        const targets = request.body.targets.map((t) => {
          const strand = d.view.strands.find((s) => s.key === t.strandKey);
          if (!strand) throw new ApiError(409, "strand_changed", messages.strandChanged());
          if (strand.shared) throw new ApiError(409, "shared", messages.shared(strand.name));
          if (t.range !== undefined && !strand.ranges.some((r) => r.name === t.range)) throw new ApiError(404, "not_found", messages.rangeGone());
          return { strand, range: t.range };
        });
        const { patches, warnings } = lookToPatches(look, targets, d.lists);
        let name = targets[0]!.strand.name;
        try {
          const need = patches.reduce((sum, p) => sum + segmentsNeeded(d.state, d.strands.find((s) => s.key === p.key)!, p.next, d.lists, d.paint), 0);
          const free = d.view.segments.max - d.state.seg.length;
          if (need > free) throw new LayoutError("segment_budget", messages.segmentBudget(need, free), { need });
          // One strand at a time, each against the device as the last write left it.
          for (const { key, next } of patches) {
            const strand = d.strands.find((s) => s.key === key)!;
            name = strand.name;
            d = await send(writeStrand(d.state, strand, next, d.lists, d.paint, d.view.segments.max));
          }
        } catch (err) {
          throw err instanceof LayoutError ? deviceError(err, name) : err;
        }
        return { view: d.view, warnings };
      });
    },
  );
}
