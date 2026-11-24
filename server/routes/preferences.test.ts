import { describe, expect, it } from "vitest";
import { makeTestApp } from "../../test/testApp";

const put = (t: ReturnType<typeof makeTestApp>, key: string, value: unknown) =>
  t.inject({ method: "PUT", url: `/api/preferences/${encodeURIComponent(key)}`, payload: { value } });

describe("preferences", () => {
  // Fails if PUT does not store the value, or GET does not return all keys as one object.
  it("stores a value and returns it from GET", async () => {
    const t = makeTestApp();
    expect((await put(t, "fav", ["Chase"])).statusCode).toBe(204);
    const res = await t.inject({ method: "GET", url: "/api/preferences" });
    expect(res.json()).toEqual({ fav: ["Chase"] });
  });

  // Fails if the key pattern is not enforced.
  it("rejects a key with a space", async () => {
    const res = await put(makeTestApp(), "a b", 1);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "invalid_request" });
  });

  // Fails if the 64 KB value limit is not enforced.
  it("rejects a value over 64 KB", async () => {
    const res = await put(makeTestApp(), "big", "x".repeat(65 * 1024));
    expect(res.statusCode).toBe(400);
  });

  // Fails if the 256-key cap is missing, counts updates of existing keys, or is not 400.
  it("rejects a 257th new key and still updates an existing one", async () => {
    const t = makeTestApp();
    for (let i = 0; i < 256; i++) expect((await put(t, `k${i}`, i)).statusCode).toBe(204);
    expect((await put(t, "extra", 1)).statusCode).toBe(400);
    expect((await put(t, "k0", "new")).statusCode).toBe(204);
  });
});
