import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Startup configuration, read from environment variables. Each value has a
 * default, so the process starts with an empty environment.
 */
export interface Config {
  port: number;
  /** The directory for the SQLite file. */
  dataDir: string;
  /** The built frontend. */
  webDistDir: string;
  /** The timeout for one request to a device. */
  deviceTimeoutMs: number;
  /** How long one discovery request listens for mDNS replies. */
  discoveryWindowMs: number;
  /**
   * Host names that `/api` accepts besides IP addresses, `localhost` and
   * `*.local` (see `requestGuard.ts`). `"*"` turns the Host check off.
   */
  allowedHosts: string[] | "*";
}

// The package root. This module sits at server/config.ts in tests and is
// bundled into dist-server/server.js by the build. Both are one directory
// under the package root, which holds dist/ and data/.
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** Reads a positive integer, or the default when unset. A bad value throws at start. */
function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return value;
}

function dir(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  return path.resolve(projectRoot, env[name]?.trim() || fallback);
}

function allowedHosts(raw: string | undefined): string[] | "*" {
  if (raw?.trim() === "*") return "*";
  return (raw ?? "")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter((h) => h !== "");
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return {
    port: positiveInt(env, "PORT", 3000),
    dataDir: dir(env, "DATA_DIR", "data"),
    webDistDir: dir(env, "WEB_DIST_DIR", "dist"),
    deviceTimeoutMs: positiveInt(env, "DEVICE_TIMEOUT_MS", 3000),
    discoveryWindowMs: positiveInt(env, "DISCOVERY_WINDOW_MS", 2500),
    allowedHosts: allowedHosts(env.ALLOWED_HOSTS),
  };
}
