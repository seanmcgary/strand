import type { FastifyError, FastifyInstance } from "fastify";
import type { ApiErrorBody, ErrorCode } from "../shared/apiTypes";

/** An expected failure. The error handler sends it as `status` with `{ error: code, message }`, plus `need` when set. */
export class ApiError extends Error {
  status: number;
  code: ErrorCode;
  need?: number;

  constructor(status: number, code: ErrorCode, message: string, extra?: { need: number }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (extra) this.need = extra.need;
  }
}

/** The text of each error message. Where the design's mock has a text, this is it. */
export const messages = {
  notFound: (): string => "This device isn't in the app any more.",
  deviceOffline: (name: string): string => `${name} isn't responding.`,
  deviceBusy: (name: string): string => `${name} is busy. Try again in a moment.`,
  deviceError: (name: string, detail: string): string => `${name} returned an error (${detail}).`,
  noDevice: (host: string): string =>
    `No WLED device answered at ${host}. Check the address and that the device is powered on.`,
  alreadyAdded: (name: string): string => `${name} is already in your devices.`,
  pinRequired: (): string => "This device's settings are protected by a PIN.",
  wrongPin: (): string => "That PIN didn't work.",
  firmwareUnsupported: (name: string): string =>
    `${name} runs a firmware version that this app does not support.`,
  invalidRequest: (): string => "That request isn't valid.",
  strandChanged: (): string => "That strand isn't on this controller any more.",
  shared: (strand: string): string =>
    `${strand} shares a segment with another strand. Choose Split or Combine on the Lights tab first.`,
  segmentBudget: (need: number, free: number): string =>
    `This needs ${need} more segment${need === 1 ? "" : "s"} and ${free} ${free === 1 ? "is" : "are"} free. Remove a range first.`,
  invalidLayout: (): string => "That layout doesn't fit this strand.",
  matrixLayout: (): string => "2D matrix layouts aren't supported yet.",
  contentTooLarge: (): string => "This setup is too large to save.",
  invalidName: (): string => "Names need 1 to 64 characters.",
  notAdjacent: (): string => "Only strands whose LEDs touch can be combined.",
  tooManyScenes: (): string => "A device can keep 256 scenes.",
  tooManyLooks: (): string => "A device can keep 256 looks.",
  painted: (): string => "A range with painted LEDs can't be saved as a look.",
  sceneGone: (): string => "That scene was deleted.",
  lookGone: (): string => "That look was deleted.",
  rangeGone: (): string => "That range isn't on the strand any more. Pick it again.",
};

function isClientError(error: unknown): error is FastifyError {
  const status = (error as Partial<FastifyError> | null)?.statusCode;
  return typeof status === "number" && status >= 400 && status <= 499;
}

/**
 * Sends every error as `{ error, message }`:
 *
 * - an `ApiError` as its own status, with `need` when it has one and `Retry-After: 1` for `device_busy`;
 * - a Fastify client error (bad or empty JSON, 413, 415, schema validation) as
 *   its status with `invalid_request`. It is not logged: its message can echo
 *   the request body, which can hold a PIN;
 * - anything else as `500 device_error`, logging only the message and stack.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof ApiError) {
      if (error.code === "device_busy") reply.header("retry-after", "1");
      const body: ApiErrorBody = {
        error: error.code,
        message: error.message,
        ...(error.need === undefined ? {} : { need: error.need }),
      };
      return reply.code(error.status).send(body);
    }
    if (isClientError(error)) {
      const body: ApiErrorBody = { error: "invalid_request", message: messages.invalidRequest() };
      return reply.code(error.statusCode ?? 400).send(body);
    }
    // Only the message and the stack: other fields of an error can hold request or device data.
    const { message, stack } = error instanceof Error ? error : new Error(String(error));
    request.log.error({ err: { message, stack } }, "request failed");
    const body: ApiErrorBody = { error: "device_error", message: "Something went wrong on the server." };
    return reply.code(500).send(body);
  });
}
