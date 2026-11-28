import type { Look, RangeSnapshot, RangeView, SlotLook, SlotView, StrandPatch, StrandSnapshot, StrandView } from "../../shared/apiTypes";
import { messages } from "../errors";
import type { Lists, Strand } from "./layoutRead";
import { LayoutError } from "./layoutWrite";

/**
 * Turns a strand view into saved content (scenes, looks) and saved content
 * back into a strand patch. Pure functions; the endpoints do the I/O.
 */

const warn = {
  ledCount: (len: number, ledCount: number): string => `The strand has ${len} LEDs now, not ${ledCount}. The ranges were fitted to the new length.`,
  effectMissing: (name: string): string => `${name} isn't on this controller. Solid is used instead.`,
  paletteMissing: (name: string): string => `${name} isn't on this controller. Default is used instead.`,
  everyTooShort: (range: string, n: number): string => `${range} is too short for Every ${n} now, so it uses All.`,
  lookTooShort: (range: string): string => `${range} is too short for this look.`,
};

const slotLook = ({ on: _on, ...look }: SlotView): SlotLook => ({ ...look, col: look.col.map((c) => [...c]) });

const copyPattern = (p: RangeSnapshot["pattern"]): RangeSnapshot["pattern"] => ({ ...p });

/** The patch's slot: the saved look with `on` set. */
const withOn = (slot: SlotLook, on: boolean): SlotView => ({ ...slot, col: slot.col.map((c) => [...c]), on });

/** An Every range needs `(n − 1) · group < len` (Plan decision 4). */
const tooShort = (pattern: RangeSnapshot["pattern"], len: number): boolean => pattern.kind === "every" && (pattern.n - 1) * pattern.group >= len;

export function snapshotStrand(view: StrandView): StrandSnapshot {
  return {
    on: view.on,
    bri: view.bri,
    ranges: view.ranges.map((r) => ({
      name: r.name,
      start: r.start,
      len: r.len,
      pattern: copyPattern(r.pattern),
      slots: r.slots.map(slotLook),
      ...(r.paint ? { paint: [...r.paint] } : {}),
    })),
  };
}

/** The look a range keeps. A painted range has none, so it throws `painted`. */
export function lookFromRange(range: RangeView): Look {
  if (range.pattern.kind === "individual") throw new LayoutError("painted", messages.painted());
  return { pattern: { ...range.pattern }, slots: range.slots.map(slotLook) };
}

/** `ranges` stretched or cut to `len` LEDs. A range that cannot hold its Every pattern any more becomes All with its first slot. */
export function fitRanges(ranges: RangeSnapshot[], len: number): { ranges: RangeSnapshot[]; warnings: string[] } {
  const warnings: string[] = [];
  const kept = ranges.filter((r) => r.start < len).map((r) => ({ ...r }));
  const last = kept[kept.length - 1];
  if (last && last.start + last.len !== len) {
    const newLen = len - last.start;
    last.len = newLen;
    if (last.paint) {
      const edge = last.paint[last.paint.length - 1];
      last.paint = last.paint.slice(0, newLen);
      while (last.paint.length < newLen && edge !== undefined) last.paint.push(edge);
    }
    if (tooShort(last.pattern, newLen)) {
      warnings.push(warn.everyTooShort(last.name, (last.pattern as { n: number }).n));
      last.pattern = { kind: "all" };
      last.slots = last.slots.slice(0, 1);
    }
  }
  return { ranges: kept, warnings };
}

const find = (names: string[], id: number, name: string): number => (names[id] === name ? id : names.indexOf(name));

/** The slot with its effect and palette found again on this controller: by ID when the name matches, else by name, else the default. */
export function resolveSlot(slot: SlotLook, lists: Lists): { slot: SlotLook; warnings: string[] } {
  const warnings: string[] = [];
  const out = { ...slot, col: slot.col.map((c) => [...c]) };
  const fx = find(lists.effects, slot.fx, slot.fxName);
  if (fx >= 0) out.fx = fx;
  else {
    out.fx = 0;
    out.fxName = "Solid";
    warnings.push(warn.effectMissing(slot.fxName));
  }
  const pal = find(lists.palettes, slot.pal, slot.palName);
  if (pal >= 0) out.pal = pal;
  else {
    out.pal = 0;
    out.palName = "Default";
    warnings.push(warn.paletteMissing(slot.palName));
  }
  return { slot: out, warnings };
}

/** Resolves every slot, with each warning once. */
function resolveSlots(slots: SlotLook[], lists: Lists, warnings: Set<string>): SlotLook[] {
  return slots.map((s) => {
    const r = resolveSlot(s, lists);
    r.warnings.forEach((w) => warnings.add(w));
    return r.slot;
  });
}

/** The strand content a scene gives `strand`, fitted to the strand's length. */
export function sceneToPatch(snapshot: StrandSnapshot, ledCount: number, strand: Strand, lists: Lists): { next: StrandPatch; warnings: string[] } {
  const warnings = new Set<string>();
  if (strand.len !== ledCount) warnings.add(warn.ledCount(strand.len, ledCount));
  const fitted = fitRanges(snapshot.ranges, strand.len);
  fitted.warnings.forEach((w) => warnings.add(w));
  const ranges: RangeView[] = fitted.ranges.map((r) => ({
    name: r.name,
    start: r.start,
    len: r.len,
    pattern: r.pattern,
    slots: resolveSlots(r.slots, lists, warnings).map((s) => withOn(s, snapshot.on)),
    ...(r.paint ? { paint: r.paint } : {}),
  }));
  return { next: { on: snapshot.on, bri: snapshot.bri, ranges }, warnings: [...warnings] };
}

/**
 * The strand content each target gets from `look`. A target without `range`
 * covers every range of its strand. A range too short for the look stays as it
 * is, with a warning; a target that changes no range gets no patch.
 */
export function lookToPatches(
  look: Look,
  targets: { strand: StrandView; range?: string }[],
  lists: Lists,
): { patches: { key: string; next: StrandPatch }[]; warnings: string[] } {
  const warnings = new Set<string>();
  const patches: { key: string; next: StrandPatch }[] = [];
  for (const { strand, range } of targets) {
    let changed = false;
    const ranges = strand.ranges.map((r) => {
      if (range !== undefined && r.name !== range) return r;
      if (tooShort(look.pattern, r.len)) {
        warnings.add(warn.lookTooShort(r.name));
        return r;
      }
      changed = true;
      const slots = resolveSlots(look.slots, lists, warnings).map((s) => withOn(s, true));
      return { name: r.name, start: r.start, len: r.len, pattern: { ...look.pattern }, slots };
    });
    if (changed) patches.push({ key: strand.key, next: { ranges } });
  }
  return { patches, warnings: [...warnings] };
}
