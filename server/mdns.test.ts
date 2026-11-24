import { describe, expect, it } from "vitest";
import { browseWled, resolveA } from "./mdns";

describe("mdns", () => {
  it("browseWled ends after its window", async () => {
    // Fails if browseWled never resolves or leaves its socket open past the window.
    const start = Date.now();
    const result = await browseWled(50);
    expect(Array.isArray(result)).toBe(true);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("resolveA resolves null for a name nobody answers", async () => {
    // Fails if resolveA rejects, hangs, or returns a value for an unanswered name.
    await expect(resolveA("strand-test-nonexistent.local", 100)).resolves.toBeNull();
  });
});
