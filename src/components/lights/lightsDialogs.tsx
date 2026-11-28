import type { FormEvent, KeyboardEvent } from "react"
import { compose, withHandlers, withState } from "recompose"
import type { LedOutput, LightsView, StrandView } from "../../../shared/apiTypes"
import { CancelButton, DialogShell, Spinner } from "@/components/dialogShell"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { adjacentPairs, COMBINE_BUTTON_ID, cutRanges, nameError, pinLabel, rangeMenuId, strandMenuId } from "@/lights/model"
import { FORM_DESCRIPTION, FORM_MESSAGE, INPUT, LABEL } from "@/lib/dialogStyles"
import { cn } from "@/lib/utils"
import type { ThunkError } from "@/store/createApiThunk"

const SUBTLE_BOX = "rounded-md border bg-muted/40 p-3"
const RADIO_ROW =
  "flex w-full items-center gap-3 rounded-md border p-3 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-checked:border-primary aria-checked:bg-primary/10"

/** A dialog the Lights tab has open. A rename with `i` renames that range, without it the strand. */
export type LightsDialog = { kind: "rename"; key: string; i?: number } | { kind: "separate"; key: string } | { kind: "combine" }

type Status = "idle" | "loading" | "ok" | "error"

export interface LightsDialogsProps {
  dialog: LightsDialog
  view: LightsView
  outputs: LedOutput[] | null
  outputsStatus: Status
  outputsError: ThunkError | null
  onRetryOutputs: () => void
  onClose: () => void
  onRenameRange: (key: string, i: number, name: string) => void
  /** Resolves to the server's message when it refuses the name, else null. */
  onRenameStrand: (key: string, name: string) => Promise<string | null>
  onCombine: (a: StrandView, b: StrandView) => Promise<void>
  onSeparate: (key: string) => Promise<void>
}

/** The control that opened the dialog, which gets focus back when it closes. */
function returnTarget(d: LightsDialog): HTMLElement | null {
  const id = d.kind === "combine" ? COMBINE_BUTTON_ID : d.kind === "rename" && d.i !== undefined ? rangeMenuId(d.key, d.i) : strandMenuId(d.key)
  // A combine or a separate can remove that control; the selected strand's ⋯ button is there instead.
  return document.getElementById(id) ?? document.querySelector<HTMLElement>('section[aria-labelledby="strand-h"] [aria-haspopup="menu"]')
}

interface ShellProps {
  dialog: LightsDialog
  onClose: () => void
  title: string
  description?: string
  children: React.ReactNode
}

const Shell = ({ dialog, ...rest }: ShellProps) => <DialogShell returnFocus={() => returnTarget(dialog)} {...rest} />

// Rename (range or strand) ---------------------------------------------------

interface RenameState {
  name: string
  setName: (v: string) => void
  error: string | null
  setError: (v: string | null) => void
  busy: boolean
  setBusy: (v: boolean) => void
}
type RenameProps = LightsDialogsProps & { dialog: { kind: "rename"; key: string; i?: number }; strand: StrandView }

/** Why `name` can't name range `i`, in the rename dialog's words, or null. */
function rangeNameError(st: StrandView, i: number, name: string): string | null {
  const t = name.trim()
  if (!t) return "A range needs a name."
  if ([...t].length > 64) return "Use 64 characters or fewer."
  return nameError(st.ranges, i, t) ? "Another range on this strand has that name." : null
}

function RenameView(p: RenameProps & RenameState & { onSubmit: (e: FormEvent) => void }) {
  const range = p.dialog.i !== undefined
  const help = range ? "" : `Leave it empty to go back to the default name. The output is ${pinLabel(p.strand.pins)}.`
  const describedBy = [help && "rename-input-desc", p.error && "rename-input-msg"].filter(Boolean).join(" ") || undefined
  return (
    <Shell dialog={p.dialog} onClose={p.onClose} title={range ? "Rename range" : "Rename strand"}>
      <form className="flex flex-col gap-4" noValidate onSubmit={p.onSubmit}>
        <div className="flex flex-col gap-2">
          <label htmlFor="rename-input" className={LABEL}>
            Name
          </label>
          <input
            id="rename-input"
            className={INPUT}
            value={p.name}
            maxLength={64}
            autoComplete="off"
            aria-invalid={p.error ? true : undefined}
            aria-describedby={describedBy}
            onChange={(e) => {
              p.setName(e.target.value)
              p.setError(null)
            }}
          />
          {help ? (
            <p id="rename-input-desc" className={FORM_DESCRIPTION}>
              {help}
            </p>
          ) : null}
          {p.error ? (
            <p id="rename-input-msg" role="alert" className={FORM_MESSAGE}>
              {p.error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <CancelButton />
          <Button type="submit" disabled={p.busy}>
            {p.busy ? <Spinner /> : null}
            Save
          </Button>
        </DialogFooter>
      </form>
    </Shell>
  )
}

const RenameDialog = compose<RenameProps & RenameState & { onSubmit: (e: FormEvent) => void }, RenameProps>(
  withState("name", "setName", (p: RenameProps) => (p.dialog.i !== undefined ? (p.strand.ranges[p.dialog.i]?.name ?? "") : p.strand.name)),
  withState("error", "setError", null),
  withState("busy", "setBusy", false),
  withHandlers<RenameProps & RenameState, { onSubmit: (e: FormEvent) => void }>({
    onSubmit: (p) => async (e: FormEvent) => {
      e.preventDefault()
      const { key, i } = p.dialog
      if (i !== undefined) {
        const error = rangeNameError(p.strand, i, p.name)
        if (error) return p.setError(error)
        p.onClose()
        p.onRenameRange(key, i, p.name.trim())
        return
      }
      p.setBusy(true)
      const error = await p.onRenameStrand(key, p.name.trim())
      if (error === null) return p.onClose()
      p.setBusy(false)
      p.setError(error)
    },
  }),
)(RenameView)

// Combine ---------------------------------------------------------------------

interface CombineState {
  pick: number
  setPick: (k: number) => void
  busy: boolean
  setBusy: (v: boolean) => void
}
interface CombineHandlers {
  onKey: (e: KeyboardEvent<HTMLButtonElement>) => void
  onConfirm: () => void
}

const pairId = (k: number) => `pair-${k}`
const ROVE: Record<string, (k: number, n: number) => number> = {
  ArrowDown: (k, n) => (k + 1) % n,
  ArrowRight: (k, n) => (k + 1) % n,
  ArrowUp: (k, n) => (k + n - 1) % n,
  ArrowLeft: (k, n) => (k + n - 1) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
}

function CombineView(p: LightsDialogsProps & CombineState & CombineHandlers) {
  const pairs = adjacentPairs(p.view)
  return (
    <Shell
      dialog={p.dialog}
      onClose={p.onClose}
      title="Combine strands?"
      description="A combined strand works as one: one switch, one brightness, and ranges that can run across the join. Only strands whose LEDs touch can combine."
    >
      <div role="radiogroup" aria-label="Strands to combine" className="flex flex-col gap-2">
        {pairs.map(([a, b], k) => (
          <button
            key={`${a.key}+${b.key}`}
            type="button"
            role="radio"
            id={pairId(k)}
            aria-checked={p.pick === k}
            tabIndex={p.pick === k ? 0 : -1}
            className={RADIO_ROW}
            onClick={() => p.setPick(k)}
            onKeyDown={p.onKey}
          >
            <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-input">
              {p.pick === k ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="font-medium">
                {a.name} + {b.name}
              </span>
              <span className="text-[13px] tabular-nums text-muted-foreground">
                {a.len + b.len} LEDs · {pinLabel([...a.pins, ...b.pins])}
              </span>
            </span>
          </button>
        ))}
      </div>
      <p className="text-[13px] text-muted-foreground">Their ranges stay where they are. You can separate them again from the strand&apos;s menu.</p>
      <DialogFooter>
        <CancelButton />
        <Button type="button" disabled={p.busy || !pairs.length} onClick={p.onConfirm}>
          {p.busy ? <Spinner /> : null}
          Combine
        </Button>
      </DialogFooter>
    </Shell>
  )
}

const CombineDialog = compose<LightsDialogsProps & CombineState & CombineHandlers, LightsDialogsProps>(
  withState("pick", "setPick", 0),
  withState("busy", "setBusy", false),
  withHandlers<LightsDialogsProps & CombineState, CombineHandlers>({
    onKey: (p) => (e: KeyboardEvent<HTMLButtonElement>) => {
      const move = ROVE[e.key]
      if (!move) return
      e.preventDefault()
      const k = move(p.pick, adjacentPairs(p.view).length)
      p.setPick(k)
      document.getElementById(pairId(k))?.focus()
    },
    onConfirm: (p) => async () => {
      const pair = adjacentPairs(p.view)[p.pick]
      if (!pair) return
      p.setBusy(true)
      await p.onCombine(pair[0], pair[1])
      p.onClose()
    },
  }),
)(CombineView)

// Separate --------------------------------------------------------------------

interface SeparateState {
  busy: boolean
  setBusy: (v: boolean) => void
}
type SeparateProps = LightsDialogsProps & { dialog: { kind: "separate"; key: string }; strand: StrandView }

function CutList({ cut }: { cut: string[] }) {
  if (!cut.length) return <p className="text-sm text-muted-foreground">No range crosses the join, so every range stays as it is.</p>
  return (
    <div className={cn(SUBTLE_BOX, "flex flex-col gap-1.5 text-sm")}>
      <p className="font-medium">{cut.length === 1 ? "This range crosses" : "These ranges cross"} the join and will be cut in two:</p>
      <ul className="flex flex-col gap-1">
        {cut.map((n) => (
          <li key={n} className="flex gap-2">
            <span aria-hidden="true" className="text-muted-foreground">
              ·
            </span>
            {n}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SeparateView(p: SeparateProps & SeparateState & { onConfirm: () => void }) {
  const cut = p.outputsStatus === "ok" && p.outputs ? cutRanges(p.outputs, p.strand) : null
  return (
    <Shell
      dialog={p.dialog}
      onClose={p.onClose}
      title={`Separate ${p.strand.name}?`}
      description="Each LED output becomes its own strand again, with its own switch and brightness."
    >
      {cut ? (
        <CutList cut={cut} />
      ) : p.outputsStatus === "error" ? (
        <div className="flex flex-col items-start gap-3">
          <p role="alert" className="text-sm text-danger">
            {p.outputsError?.message ?? ""}
          </p>
          <Button type="button" variant="outline" size="sm" leadingIcon="rotate-cw" onClick={p.onRetryOutputs}>
            Try again
          </Button>
        </div>
      ) : (
        <div aria-busy="true" aria-label="Loading the LED outputs">
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      <DialogFooter>
        <CancelButton />
        <Button type="button" disabled={p.busy || cut === null} onClick={p.onConfirm}>
          {p.busy ? <Spinner /> : null}
          Separate
        </Button>
      </DialogFooter>
    </Shell>
  )
}

const SeparateDialog = compose<SeparateProps & SeparateState & { onConfirm: () => void }, SeparateProps>(
  withState("busy", "setBusy", false),
  withHandlers<SeparateProps & SeparateState, { onConfirm: () => void }>({
    onConfirm: (p) => async () => {
      p.setBusy(true)
      await p.onSeparate(p.dialog.key)
      p.onClose()
    },
  }),
)(SeparateView)

/** The Lights tab's open dialog: rename a range or a strand, combine two strands, or separate a combined one. */
export function LightsDialogs(props: LightsDialogsProps) {
  const d = props.dialog
  if (d.kind === "combine") return <CombineDialog {...props} />
  const strand = props.view.strands.find((s) => s.key === d.key)
  if (!strand) return null
  if (d.kind === "rename") return <RenameDialog {...props} dialog={d} strand={strand} />
  return <SeparateDialog {...props} dialog={d} strand={strand} />
}
