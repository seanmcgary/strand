import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../app";
import * as preferences from "../db/preferences";
import { ApiError, messages } from "../errors";

/** The most keys the table holds, and the most bytes of one serialized value (spec §8.5). */
const MAX_KEYS = 256;
const MAX_VALUE_BYTES = 64 * 1024;

const putSchema = {
  params: {
    type: "object",
    properties: { key: { type: "string", pattern: "^[a-zA-Z0-9._-]{1,64}$" } },
  },
  body: { type: "object", required: ["value"], additionalProperties: false, properties: { value: {} } },
} as const;

export async function preferencesRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  app.get("/api/preferences", async () => preferences.getAll(deps.db));

  app.put<{ Params: { key: string }; Body: { value: unknown } }>(
    "/api/preferences/:key",
    // 64 KB of value plus the JSON around it.
    { schema: putSchema, bodyLimit: 71680 },
    async (request, reply) => {
      const { key } = request.params;
      const { value } = request.body;
      if (Buffer.byteLength(JSON.stringify(value)) > MAX_VALUE_BYTES) {
        throw new ApiError(400, "invalid_request", messages.invalidRequest());
      }
      if (!preferences.has(deps.db, key) && preferences.count(deps.db) >= MAX_KEYS) {
        throw new ApiError(400, "invalid_request", messages.invalidRequest());
      }
      preferences.put(deps.db, key, value, deps.now());
      return reply.code(204).send();
    },
  );
}
