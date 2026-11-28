/**
 * `node test/demoDevices.ts`: three fake WLED devices with the design's
 * layouts (mock `lightSeed` in docs/design/strand-wled-spec.html), for running
 * the app by hand. Runs until killed.
 */
import { startFakeWled } from "./fakeWled.ts";
import { seeds } from "./fixtures/seeds.ts";

// Indexes in the seeds' effect and palette lists.
const FX = { solid: 0, breathe: 2, rainbow: 9 };
const PAL = { default: 0, ocean: 9, rainbow: 11 };

const rgb = (hex: string): number[] => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

const seg = (id: number, n: string, start: number, stop: number, hex: string, more: Record<string, unknown> = {}) => ({
  id,
  n,
  start,
  stop,
  grp: 1,
  spc: 0,
  of: 0,
  on: true,
  bri: 255,
  frz: false,
  col: [rgb(hex), [0, 0, 0], [0, 0, 0]],
  fx: FX.solid,
  pal: PAL.default,
  sx: 128,
  ix: 128,
  ...more,
});

// The mock's `candyPaint`: five red, five white, as runs for `seg.i`.
const candyPaint = (len: number): (number | string)[] =>
  Array.from({ length: Math.ceil(len / 5) }, (_, k) => [k * 5, Math.min(len, k * 5 + 5), k % 2 ? "FFFFFF" : "FF0000"]).flat();

const backyard = await startFakeWled(seeds.backyard, { port: 18081 });
backyard.applyState({
  seg: [
    seg(0, "Patio 1/2", 0, 60, "#FFB46B", { grp: 2, spc: 2 }),
    seg(1, "Patio 2/2", 2, 60, "#FF0000", { grp: 2, spc: 2 }),
    seg(2, "Kitchen", 60, 120, "#FFA000", { fx: FX.rainbow, pal: PAL.rainbow }),
    seg(3, "Rest", 120, 150, "#FFB46B", { fx: FX.breathe }),
    seg(4, "Fence", 150, 270, "#0050FF", { bri: 200, pal: PAL.ocean }),
    // Made in the WLED app: grouping that no Strand pattern uses.
    seg(5, "Porch light", 270, 300, "#FFFFFF", { bri: 200, grp: 2 }),
  ],
});

const frontRoof = await startFakeWled(seeds.frontRoof, { port: 18082 });
frontRoof.applyState({
  seg: [seg(0, "Gutter", 0, 200, "#FFB46B"), seg(1, "Peak paint", 200, 300, "#FF0000", { frz: true })],
});
frontRoof.applyState({ seg: [{ id: 1, i: candyPaint(100) }] });

const garage = await startFakeWled(seeds.garage, { port: 18083 });
garage.applyState({ seg: [seg(0, "", 0, 60, "#FFFFFF")] });

for (const [name, fake] of [
  ["Backyard", backyard],
  ["Front Roof", frontRoof],
  ["Garage", garage],
] as const) {
  console.log(`${name}: http://127.0.0.1:${fake.port}`);
}
