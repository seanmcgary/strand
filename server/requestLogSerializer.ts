/** The request fields this serializer reads. */
interface LoggableRequest {
  method?: string;
  url?: string;
}

/**
 * The Fastify/pino `req` serializer: the method and the path, never the query
 * string. Passed as `logger.serializers.req` in `buildApp`, which Fastify
 * merges over its own default (that one logs the full URL, host and client
 * address).
 */
export function serializeRequestForLog(req: LoggableRequest) {
  return {
    method: req.method,
    path: (req.url ?? "").split("?")[0],
  };
}
