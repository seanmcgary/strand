import type { FastifyInstance } from "fastify";
import type { LightsPatch, LightsView } from "../../shared/apiTypes";
import type { ServerDeps } from "../app";
import { ApiError, messages } from "../errors";
import { clearLeftovers, flashLed, readDeviceLights, setDevicePower } from "../lights/deviceLights";
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
}
