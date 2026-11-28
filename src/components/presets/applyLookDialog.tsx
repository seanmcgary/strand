import { compose, withHandlers, withState } from "recompose"
import type { LightsView, LookRecord, LookTarget } from "../../../shared/apiTypes"
import { CancelButton, Spinner } from "@/components/dialogShell"
import { Shell } from "@/components/presets/presetShell"
import type { PresetsDialogsProps } from "@/components/presets/presetsDialogTypes"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { FORM_MESSAGE } from "@/lib/dialogStyles"
import { patternText, plural, rangeLabel } from "@/lights/model"
import { cn } from "@/lib/utils"

const CHECKBOX =
  "peer relative flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-input shadow-sm before:absolute before:-inset-3 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-checked:border-primary aria-checked:bg-primary aria-checked:text-primary-foreground"

// Apply look -------------------------------------------------------------------

interface ApplyState {
  /** `${strandKey}|${rangeIndex}` -> checked. */
  checked: Record<string, boolean>
  setChecked: (c: Record<string, boolean>) => void
  error: string | null
  setError: (v: string | null) => void
  busy: boolean
  setBusy: (v: boolean) => void
}
interface ApplyHandlers {
  onStrand: (key: string) => void
  onRange: (key: string, name: string) => void
  onConfirm: () => void
}
type ApplyProps = PresetsDialogsProps & { look: LookRecord } & ApplyState & ApplyHandlers

/** A range is ticked by its strand and name, so a re-read that moves or drops ranges cannot retarget a tick. */
const rangeKey = (strandKey: string, name: string): string => `${strandKey}|${name}`
const rangeKeys = (st: { key: string; ranges: { name: string }[] }): string[] => st.ranges.map((r) => rangeKey(st.key, r.name))

/** The look's targets: a strand with every range checked is one whole-strand target. */
function targetsOf(view: LightsView, checked: Record<string, boolean>): LookTarget[] {
  return view.strands.flatMap((st) => {
    const on = st.ranges.filter((r) => checked[rangeKey(st.key, r.name)])
    if (!on.length) return []
    return on.length === st.ranges.length ? [{ strandKey: st.key }] : on.map((r) => ({ strandKey: st.key, range: r.name }))
  })
}

function Tick({ state }: { state: "true" | "false" | "mixed" }) {
  if (state === "true") return <Icon name="check" className="size-3.5 [stroke-width:3]" />
  return state === "mixed" ? <Icon name="minus" className="size-3.5 [stroke-width:3]" /> : null
}

function ApplyLookView(p: ApplyProps) {
  const count = p.view.strands.reduce((n, st) => n + rangeKeys(st).filter((k) => p.checked[k]).length, 0)
  return (
    <Shell
      dialog={p.dialog}
      onClose={p.onClose}
      initialFocus={() => {
        const free = p.view.strands.find((st) => !st.shared)
        return free ? document.getElementById(`lt-${free.key}`) : null
      }}
      title={`Apply ${p.look.name} to…`}
      description={`${patternText(p.look.look.pattern)}. Ranges keep their positions and names; their pattern, colors and effects change.`}
    >
      <ul className="flex flex-col gap-2">
        {p.view.strands.map((st) => {
          const n = rangeKeys(st).filter((k) => p.checked[k]).length
          const state = n === 0 ? "false" : n === st.ranges.length ? "true" : "mixed"
          const sid = `lt-${st.key}`
          return (
            <li key={st.key} className="rounded-md border p-3">
              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  role="checkbox"
                  id={sid}
                  className={cn(CHECKBOX, "aria-disabled:cursor-not-allowed aria-disabled:opacity-50", state === "mixed" && "border-primary text-primary")}
                  aria-checked={state}
                  aria-disabled={st.shared ? true : undefined}
                  aria-describedby={st.shared ? `${sid}-reason` : undefined}
                  onClick={() => p.onStrand(st.key)}
                >
                  <Tick state={state} />
                </button>
                <label htmlFor={sid} className="flex-1 text-sm font-medium">
                  {st.name} <span className="font-normal text-muted-foreground">· {st.len} LEDs</span>
                </label>
              </div>
              {st.shared ? (
                <p id={`${sid}-reason`} className="ml-7 mt-1 text-[13px] text-muted-foreground">Shares a segment with another strand. Choose Split or Combine on the Lights tab first.</p>
              ) : (
                <div role="group" aria-label={`${st.name} ranges`} className="ml-7 mt-2.5 flex flex-col gap-2.5">
                  {st.ranges.map((r, i) => {
                    const on = !!p.checked[rangeKey(st.key, r.name)]
                    return (
                      <div key={i} className="flex items-center gap-2.5">
                        <button type="button" role="checkbox" id={`${sid}-${i}`} className={CHECKBOX} aria-checked={on} onClick={() => p.onRange(st.key, r.name)}>
                          <Tick state={on ? "true" : "false"} />
                        </button>
                        <label htmlFor={`${sid}-${i}`} className="min-w-0 flex-1 text-sm">
                          {r.name}{" "}
                          <span className="text-muted-foreground">
                            · {rangeLabel(r)} · {patternText(r.pattern)}
                          </span>
                        </label>
                      </div>
                    )
                  })}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {p.error ? (
        <p role="alert" className={FORM_MESSAGE}>
          {p.error}
        </p>
      ) : null}
      <DialogFooter>
        <CancelButton />
        <Button type="button" disabled={p.busy || !count} onClick={p.onConfirm}>
          {p.busy ? <Spinner /> : null}
          Apply{count ? ` to ${plural(count, "range")}` : ""}
        </Button>
      </DialogFooter>
    </Shell>
  )
}

export const ApplyLookDialog = compose<ApplyProps, PresetsDialogsProps & { look: LookRecord }>(
  withState("checked", "setChecked", {}),
  withState("error", "setError", null),
  withState("busy", "setBusy", false),
  withHandlers<PresetsDialogsProps & { look: LookRecord } & ApplyState, ApplyHandlers>({
    onStrand: (p) => (key: string) => {
      const st = p.view.strands.find((s) => s.key === key)
      if (!st || st.shared) return
      const keys = rangeKeys(st)
      const all = keys.every((k) => p.checked[k])
      p.setChecked({ ...p.checked, ...Object.fromEntries(keys.map((k) => [k, !all])) })
      p.setError(null)
    },
    onRange: (p) => (key: string, name: string) => {
      p.setChecked({ ...p.checked, [rangeKey(key, name)]: !p.checked[rangeKey(key, name)] })
      p.setError(null)
    },
    onConfirm: (p) => async () => {
      const targets = targetsOf(p.view, p.checked)
      if (!targets.length) return
      p.setBusy(true)
      const error = await p.onApplyLook(p.look, targets)
      if (error === null) return p.onClose()
      p.setBusy(false)
      p.setError(error)
    },
  }),
)(ApplyLookView)

