import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  // Fails if a default changes or a variable stops having one.
  it("starts with an empty environment", () => {
    const config = loadConfig({});
    expect(config).toMatchObject({ port: 3000, deviceTimeoutMs: 3000, discoveryWindowMs: 2500, allowedHosts: [] });
    expect(config.dataDir).toMatch(/[/\\]data$/);
  });

  // Fails if a bad number falls back to the default instead of stopping the start.
  it("throws on a value that is not a positive integer", () => {
    expect(() => loadConfig({ PORT: "abc" })).toThrow(/PORT/);
  });

  // Fails if ALLOWED_HOSTS is not split on commas and trimmed.
  it("reads a host list", () => {
    expect(loadConfig({ ALLOWED_HOSTS: "a.example.com, b.ts.net" }).allowedHosts).toEqual(["a.example.com", "b.ts.net"]);
  });

  // Fails if "*" is read as a host name instead of turning the check off.
  it("reads * as any host", () => {
    expect(loadConfig({ ALLOWED_HOSTS: "*" }).allowedHosts).toBe("*");
  });
});
