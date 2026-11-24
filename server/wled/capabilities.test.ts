import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { seeds } from "../../test/fixtures/seeds";
import { parseCapabilities, pinsFromCapabilities } from "./capabilities";

const fixture = (name: string): string => readFileSync(new URL(`../../test/fixtures/${name}`, import.meta.url), "utf8");

const LIMITS = { maxLedsPerOutput: 2048, ledMemoryBytes: 87040, maxLeds: 16384, maxDigitalOutputs: 16, maxPwmPins: 16 };

describe("parseCapabilities", () => {
  // Fails if the 8-argument (0.15) bLimits mapping, the unquoted-key fix or the list parsing breaks.
  it("reads the 0.15 text", () => {
    const caps = parseCapabilities(fixture("sjsV015.txt"));
    expect(caps).toMatchObject({
      limits: LIMITS,
      reservedPins: [6, 7, 8, 9, 10, 11],
      inputOnlyPins: [34, 35, 36, 37, 38, 39],
      maxGpio: 40,
    });
    expect(caps?.ledTypes).toEqual([
      { i: 22, c: 1, t: "D", n: "WS281x" },
      { i: 30, c: 3, t: "D", n: "SK6812/WS2814 RGBW" },
      { i: 45, c: 7, t: "AAAAA", n: "PWM RGBCCT" },
    ]);
  });

  // Fails if the 10-argument (17.0.0-dev) bLimits mapping reads the wrong positions.
  it("reads the 17 text", () => {
    expect(parseCapabilities(fixture("sjsV17.txt"))?.limits).toEqual(LIMITS);
  });

  // Fails if the trailing comma that an Ethernet build prints is read as a pin.
  it("drops the empty item of a trailing comma", () => {
    expect(parseCapabilities(fixture("sjsEthernet.txt"))?.reservedPins).toEqual([6, 7, 8]);
  });

  // Fails if an unknown bLimits count, a missing list or a cut-off text is accepted.
  it.each([
    ["an unknown bLimits argument count", fixture("sjsUnsupported.txt")],
    ["no ledTypes", fixture("sjsV17.txt").replace(/d\.ledTypes=\[.*?\];/, "")],
    ["a cut-off ledTypes", "function GetV(){var d=document;d.ledTypes=[{i:1,c:"],
  ])("returns null for %s", (_name, text) => {
    expect(parseCapabilities(text)).toBeNull();
  });

  // Fails if a key-like text inside a quoted name is rewritten as a key.
  it("leaves a name that holds a key-like text as it is", () => {
    const text = fixture("sjsV17.txt").replace('n:"WS281x"', 'n:"a,b:c"');
    expect(parseCapabilities(text)?.ledTypes[0]?.n).toBe("a,b:c");
  });
});

describe("pinsFromCapabilities", () => {
  // Fails if reserved pins are listed, input-only bits are missing, or the config's pins are not marked as owned.
  it("lists the free GPIOs and marks the pins the config uses", () => {
    const caps = parseCapabilities(fixture("sjsV015.txt"))!;
    const cfg = structuredClone(seeds.backyard.cfg) as unknown as { hw: { relay: { pin: number }; ir: { pin: number } } };
    cfg.hw.relay.pin = 21;
    cfg.hw.ir.pin = 22;
    const pins = pinsFromCapabilities(caps, cfg);
    const byPin = new Map(pins.map((p) => [p.p, p]));
    expect(pins).toHaveLength(34);
    expect(byPin.has(6)).toBe(false);
    expect(byPin.get(16)).toMatchObject({ a: true, n: "LEDs" });
    expect(byPin.get(17)).toMatchObject({ a: true, n: "LEDs" });
    expect(byPin.get(0)).toMatchObject({ a: true, n: "Button" });
    expect(byPin.get(21)).toMatchObject({ a: true, n: "Relay" });
    expect(byPin.get(22)).toMatchObject({ a: true, n: "IR" });
    expect(byPin.get(34)!.c & 0x20).toBe(0x20);
    expect(byPin.get(4)).toEqual({ p: 4, c: 0, a: false });
  });
});
