import type { FastifyInstance } from "fastify";
import type { ApplyResult, Scene } from "../../shared/apiTypes";
import type { ServerDeps } from "../app";
import * as scenes from "../db/scenes";
import { ApiError, messages } from "../errors";
import { clearLeftovers, deviceError, readDeviceLights, writeLayout } from "../lights/deviceLights";
import { LayoutError, writeStrand } from "../lights/layoutWrite";
import { sceneToPatch, snapshotStrand } from "../lights/snapshots";
import { loadDevice } from "./settings";

const NAME_CHARS = 64;
const MAX_SCENES = 256;
const MAX_CONTENT_BYTES = 65536;

const nameProp = { type: "string", maxLength: 1024 } as const;
const saveBody = {
  type: "object",
  required: ["name", "strandKey"],
  additionalProperties: false,
  properties: { name: nameProp, strandKey: { type: "string", pattern: "^o\\d+(\\+o\\d+)*$" } },
} as const;
const renameBody = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: { name: nameProp },
} as const;

/** The trimmed name, or `422 invalid_name`. */
function checkedName(name: string): string {
  const trimmed = name.trim();
  const chars = [...trimmed].length;
  if (chars < 1 || chars > NAME_CHARS) throw new ApiError(422, "invalid_name", messages.invalidName());
  return trimmed;
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? "" : "s"}`;

export function toScene(row: scenes.SceneRow): Scene {
  const { on, bri, ranges } = row.content;
  return {
    id: row.id,
    name: row.name,
    strandKey: row.strandKey,
    ledCount: row.ledCount,
    summary: `${plural(ranges.length, "range")} · ${on ? `${Math.round((bri / 255) * 100)}%` : "off"}`,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
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
      if (scenes.count(deps.db, row.id) >= MAX_SCENES) throw new ApiError(422, "too_many", messages.tooManyScenes());
      const view = (await readDeviceLights(deps, row)).view.strands.find((s) => s.key === request.body.strandKey);
      if (!view) throw new ApiError(409, "strand_changed", messages.strandChanged());
      const content = snapshotStrand(view);
      if (Buffer.byteLength(JSON.stringify(content)) > MAX_CONTENT_BYTES) throw new ApiError(422, "invalid_layout", messages.contentTooLarge());
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
      const d = await clearLeftovers(deps, await readDeviceLights(deps, row));
      const strand = d.strands.find((s) => s.key === scene.strandKey);
      const view = d.view.strands.find((s) => s.key === scene.strandKey);
      if (!strand || !view) throw new ApiError(409, "strand_changed", messages.strandChanged());
      if (view.shared) throw new ApiError(409, "shared", messages.shared(view.name));
      try {
        const { next, warnings } = sceneToPatch(scene.content, scene.ledCount, strand, d.lists);
        const write = writeStrand(d.state, strand, next, d.lists, d.paint, d.view.segments.max);
        return { view: (await writeLayout(deps, d, write)).view, warnings };
      } catch (err) {
        throw err instanceof LayoutError ? deviceError(err, strand.name) : err;
      }
    },
  );
}
