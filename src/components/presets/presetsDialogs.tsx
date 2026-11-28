import type { FormEvent } from "react"
import { compose, withHandlers, withState } from "recompose"
import type { LightsView, LookRecord, LookTarget, Scene } from "../../../shared/apiTypes"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { applyLookId, applySceneId, patternText, plural, presetMenuId, rangeLabel, SAVE_LOOK_ID, SAVE_SCENE_ID } from "@/lights/model"
import { cn } from "@/lib/utils"

const LABEL = "text-sm font-medium leading-none"
const FORM_DESCRIPTION = "text-[13px] leading-snug text-muted-foreground"
const FORM_MESSAGE = "text-[13px] font-medium text-danger"
const INPUT =
  "flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:ring-danger sm:text-sm"
const SELECT =
  "flex h-10 w-full appearance-none items-center justify-between whitespace-nowrap rounded-md border border-input bg-background py-2 pl-3 pr-9 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
const CHECKBOX =
  "peer relative flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border border-input shadow-sm before:absolute before:-inset-3 before:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-checked:border-primary aria-checked:bg-primary aria-checked:text-primary-foreground"

export type PresetKind = "scene" | "look"

/** A dialog the Presets tab has open. */
export type PresetsDialog =
  | { kind: "saveScene" }
  | { kind: "saveLook" }
  | { kind: "applyLook"; id: string }
  | { kind: "sceneWarn"; id: string }
  | { kind: "rename"; preset: PresetKind; id: string }
  | { kind: "delete"; preset: PresetKind; id: string }

export interface PresetsDialogsProps {
  dialog: PresetsDialog
  view: LightsView
  scenes: Scene[]
  looks: LookRecord[]
  /** The strand the Lights tab has selected: the save dialogs start on it. */
  selectedKey: string
  onClose: () => void
  /** The save, rename and apply-look calls resolve to the server's message when it refuses, else null. */
  onSaveScene: (name: string, strandKey: string) => Promise<string | null>
  onSaveLook: (name: string, strandKey: string, range: string) => Promise<string | null>
  onRename: (preset: PresetKind, id: string, name: string) => Promise<string | null>
  onApplyLook: (look: LookRecord, targets: LookTarget[]) => Promise<string | null>
  onApplyScene: (scene: Scene) => void
  /** Resolves to whether it deleted; a refusal has toasted. */
  onDelete: (preset: PresetKind, id: string, name: string) => Promise<boolean>
}

/** The control that opened the dialog, which gets focus back when it closes. */
function returnTarget(d: PresetsDialog): HTMLElement | null {
  const byId = (id: string) => document.getElementById(id)
  const addButton = (preset: PresetKind) => byId(preset === "scene" ? SAVE_SCENE_ID : SAVE_LOOK_ID)
  switch (d.kind) {
    case "saveScene":
      return byId(SAVE_SCENE_ID)
    case "saveLook":
      return byId(SAVE_LOOK_ID)
    case "applyLook":
      return byId(applyLookId(d.id))
    case "sceneWarn":
      return byId(applySceneId(d.id))
    // A deleted row has no menu any more; its section's save button takes the focus.
    default:
      return byId(presetMenuId(d.preset, d.id)) ?? addButton(d.preset)
  }
}

function Spinner() {
  return <Icon name="loader-circle" className="motion-safe:animate-spin" />
}

interface ShellProps {
  dialog: PresetsDialog
  onClose: () => void
  title: string
  description?: string
  /** A confirm dialog has no close button; Cancel is the first control. */
  confirm?: boolean
  children?: React.ReactNode
}

/** An open dialog that returns focus to the control that opened it. */
function Shell({ dialog, onClose, title, description, confirm, children }: ShellProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-w-md"
        showCloseButton={!confirm}
        {...(description ? {} : { "aria-describedby": undefined })}
        onCloseAutoFocus={(e) => {
          const el = returnTarget(dialog)
          if (!el) return
          e.preventDefault()
          el.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

const CancelButton = () => (
  <DialogClose asChild>
    <Button type="button" variant="outline">
      Cancel
    </Button>
  </DialogClose>
)

function NameField({ value, error, placeholder, onChange }: { value: string; error: string | null; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="preset-name" className={LABEL}>
        Name
      </label>
      <input
        id="preset-name"
        className={INPUT}
        value={value}
        maxLength={64}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "preset-name-msg" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <p id="preset-name-msg" role="alert" className={FORM_MESSAGE}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

function SubmitFooter({ label, busy, disabled }: { label: string; busy: boolean; disabled?: boolean }) {
  return (
    <DialogFooter>
      <CancelButton />
      <Button type="submit" disabled={busy || disabled}>
        {busy ? <Spinner /> : null}
        {label}
      </Button>
    </DialogFooter>
  )
}

function SelectField(p: { id: string; label: string; help?: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={p.id} className={LABEL}>
        {p.label}
      </label>
      <div className="relative w-full">
        <select id={p.id} className={SELECT} value={p.value} aria-describedby={p.help ? `${p.id}-desc` : undefined} onChange={(e) => p.onChange(e.target.value)}>
          {p.children}
        </select>
        <Icon name="chevron-down" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-60" />
      </div>
      {p.help ? (
        <p id={`${p.id}-desc`} className={FORM_DESCRIPTION}>
          {p.help}
        </p>
      ) : null}
    </div>
  )
}

/** The form state every dialog with a name field shares. */
interface FormState {
  name: string
  setName: (v: string) => void
  error: string | null
  setError: (v: string | null) => void
  busy: boolean
  setBusy: (v: boolean) => void
}
const withForm = (initialName: (p: never) => string) => [
  withState("name", "setName", initialName),
  withState("error", "setError", null),
  withState("busy", "setBusy", false),
]

/** Runs a save that resolves to the server's message when it refuses; closes on success. */
async function submit(p: PresetsDialogsProps & FormState, run: () => Promise<string | null>) {
  p.setBusy(true)
  const error = await run()
  if (error === null) return p.onClose()
  p.setBusy(false)
  p.setError(error)
}

// Save scene -------------------------------------------------------------------

interface SceneState {
  strandKey: string
  setStrandKey: (v: string) => void
}
type SceneProps = PresetsDialogsProps & FormState & SceneState & { onSubmit: (e: FormEvent) => void }

function SaveSceneView(p: SceneProps) {
  return (
    <Shell
      dialog={p.dialog}
      onClose={p.onClose}
      title="Save scene"
      description="Saves the strand's ranges, patterns, colors, effects, paint, power and brightness as they are now."
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={p.onSubmit}>
        <NameField
          value={p.name}
          error={p.error}
          placeholder="Evening glow"
          onChange={(v) => {
            p.setName(v)
            p.setError(null)
          }}
        />
        <SelectField id="scene-strand" label="Strand" value={p.strandKey} onChange={p.setStrandKey}>
          {p.view.strands.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name} · {s.len} LEDs
            </option>
          ))}
        </SelectField>
        <SubmitFooter label="Save scene" busy={p.busy} />
      </form>
    </Shell>
  )
}

const SaveSceneDialog = compose<SceneProps, PresetsDialogsProps>(
  ...withForm(() => ""),
  withState("strandKey", "setStrandKey", (p: PresetsDialogsProps) => p.selectedKey),
  withHandlers<PresetsDialogsProps & FormState & SceneState, { onSubmit: (e: FormEvent) => void }>({
    onSubmit: (p) => (e: FormEvent) => {
      e.preventDefault()
      const name = p.name.trim()
      if (!name) return p.setError("Give the scene a name.")
      void submit(p, () => p.onSaveScene(name, p.strandKey))
    },
  }),
)(SaveSceneView)

// Save look --------------------------------------------------------------------

interface LookState {
  target: string
  setTarget: (v: string) => void
}
type LookProps = PresetsDialogsProps & FormState & LookState & { onSubmit: (e: FormEvent) => void }

/** The range the save-look dialog starts on: the selected strand's first that can be a look, else any strand's. */
function firstLookRange(p: PresetsDialogsProps): string {
  const selected = p.view.strands.find((s) => s.key === p.selectedKey)
  const order = [...(selected ? [selected] : []), ...p.view.strands.filter((s) => s !== selected)]
  for (const s of order) {
    const i = s.ranges.findIndex((r) => r.pattern.kind !== "individual")
    if (i >= 0) return `${s.key}|${i}`
  }
  return ""
}

function SaveLookView(p: LookProps) {
  return (
    <Shell
      dialog={p.dialog}
      onClose={p.onClose}
      title="Save look"
      description="Saves a range's pattern with its colors, effects and palettes. A look has no LED positions, so it fits any range."
    >
      <form className="flex flex-col gap-4" noValidate onSubmit={p.onSubmit}>
        <NameField
          value={p.name}
          error={p.error}
          placeholder="Candy cane"
          onChange={(v) => {
            p.setName(v)
            p.setError(null)
          }}
        />
        <SelectField id="look-range" label="Range" value={p.target} onChange={p.setTarget} help="Ranges with painted LEDs can't be saved as a look.">
          {p.target ? null : (
            <option value="" disabled>
              Choose a range
            </option>
          )}
          {p.view.strands.map((s) => (
            <optgroup key={s.key} label={s.name}>
              {s.ranges.map((r, i) => (
                <option key={i} value={`${s.key}|${i}`} disabled={r.pattern.kind === "individual"}>
                  {r.name} · {patternText(r.pattern)}
                  {r.pattern.kind === "individual" ? " (painted LEDs can't be a look)" : ""}
                </option>
              ))}
            </optgroup>
          ))}
        </SelectField>
        <SubmitFooter label="Save look" busy={p.busy} disabled={!p.target} />
      </form>
    </Shell>
  )
}

const SaveLookDialog = compose<LookProps, PresetsDialogsProps>(
  ...withForm(() => ""),
  withState("target", "setTarget", firstLookRange),
  withHandlers<PresetsDialogsProps & FormState & LookState, { onSubmit: (e: FormEvent) => void }>({
    onSubmit: (p) => (e: FormEvent) => {
      e.preventDefault()
      const name = p.name.trim()
      if (!name) return p.setError("Give the look a name.")
      const [key, i] = p.target.split("|")
      const range = p.view.strands.find((s) => s.key === key)?.ranges[Number(i)]
      if (!range) return
      void submit(p, () => p.onSaveLook(name, key!, range.name))
    },
  }),
)(SaveLookView)

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
  onRange: (key: string, i: number) => void
  onConfirm: () => void
}
type ApplyProps = PresetsDialogsProps & { look: LookRecord } & ApplyState & ApplyHandlers

const rangeKeys = (st: { key: string; ranges: unknown[] }): string[] => st.ranges.map((_, i) => `${st.key}|${i}`)

/** The look's targets: a strand with every range checked is one whole-strand target. */
function targetsOf(view: LightsView, checked: Record<string, boolean>): LookTarget[] {
  return view.strands.flatMap((st) => {
    const on = st.ranges.filter((_, i) => checked[`${st.key}|${i}`])
    if (!on.length) return []
    return on.length === st.ranges.length ? [{ strandKey: st.key }] : on.map((r) => ({ strandKey: st.key, range: r.name }))
  })
}

function Tick({ state }: { state: "true" | "false" | "mixed" }) {
  if (state === "true") return <Icon name="check" className="size-3.5 [stroke-width:3]" />
  return state === "mixed" ? <Icon name="minus" className="size-3.5 [stroke-width:3]" /> : null
}

function ApplyLookView(p: ApplyProps) {
  const count = Object.values(p.checked).filter(Boolean).length
  return (
    <Shell
      dialog={p.dialog}
      onClose={p.onClose}
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
                  className={cn(CHECKBOX, state === "mixed" && "border-primary text-primary")}
                  aria-checked={state}
                  disabled={!!st.shared}
                  onClick={() => p.onStrand(st.key)}
                >
                  <Tick state={state} />
                </button>
                <label htmlFor={sid} className="flex-1 text-sm font-medium">
                  {st.name} <span className="font-normal text-muted-foreground">· {st.len} LEDs</span>
                </label>
              </div>
              {st.shared ? (
                <p className="ml-7 mt-1 text-[13px] text-muted-foreground">Shares a segment with another strand. Choose Split or Combine on the Lights tab first.</p>
              ) : (
                <ul role="group" aria-label={`${st.name} ranges`} className="ml-7 mt-2.5 flex flex-col gap-2.5">
                  {st.ranges.map((r, i) => {
                    const on = !!p.checked[`${st.key}|${i}`]
                    return (
                      <li key={i} className="flex items-center gap-2.5">
                        <button type="button" role="checkbox" id={`${sid}-${i}`} className={CHECKBOX} aria-checked={on} onClick={() => p.onRange(st.key, i)}>
                          <Tick state={on ? "true" : "false"} />
                        </button>
                        <label htmlFor={`${sid}-${i}`} className="min-w-0 flex-1 text-sm">
                          {r.name}{" "}
                          <span className="text-muted-foreground">
                            · {rangeLabel(r)} · {patternText(r.pattern)}
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
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

const ApplyLookDialog = compose<ApplyProps, PresetsDialogsProps & { look: LookRecord }>(
  withState("checked", "setChecked", {}),
  withState("error", "setError", null),
  withState("busy", "setBusy", false),
  withHandlers<PresetsDialogsProps & { look: LookRecord } & ApplyState, ApplyHandlers>({
    onStrand: (p) => (key: string) => {
      const st = p.view.strands.find((s) => s.key === key)
      if (!st) return
      const keys = rangeKeys(st)
      const all = keys.every((k) => p.checked[k])
      p.setChecked({ ...p.checked, ...Object.fromEntries(keys.map((k) => [k, !all])) })
      p.setError(null)
    },
    onRange: (p) => (key: string, i: number) => {
      p.setChecked({ ...p.checked, [`${key}|${i}`]: !p.checked[`${key}|${i}`] })
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

// Scene LED-count warning --------------------------------------------------------

function SceneWarnView(p: PresetsDialogsProps & { scene: Scene }) {
  const st = p.view.strands.find((s) => s.key === p.scene.strandKey)
  const now = st?.len ?? 0
  return (
    <Shell
      dialog={p.dialog}
      onClose={p.onClose}
      confirm
      title={`Apply ${p.scene.name}?`}
      description={`${st?.name ?? "The strand"} has ${now} LEDs now. This scene was saved when it had ${p.scene.ledCount}. Strand fits its ranges to the new length: ${
        now < p.scene.ledCount ? "ranges past the end are cut" : "the last range grows to the end"
      }.`}
    >
      <DialogFooter>
        <CancelButton />
        <Button
          type="button"
          onClick={() => {
            p.onClose()
            p.onApplyScene(p.scene)
          }}
        >
          Apply anyway
        </Button>
      </DialogFooter>
    </Shell>
  )
}

// Rename -------------------------------------------------------------------------

type RenameProps = PresetsDialogsProps & { dialog: { kind: "rename"; preset: PresetKind; id: string }; name0: string } & FormState & {
    onSubmit: (e: FormEvent) => void
  }

function RenameView(p: RenameProps) {
  return (
    <Shell dialog={p.dialog} onClose={p.onClose} title={p.dialog.preset === "scene" ? "Rename scene" : "Rename look"}>
      <form className="flex flex-col gap-4" noValidate onSubmit={p.onSubmit}>
        <NameField
          value={p.name}
          error={p.error}
          onChange={(v) => {
            p.setName(v)
            p.setError(null)
          }}
        />
        <SubmitFooter label="Save" busy={p.busy} />
      </form>
    </Shell>
  )
}

const RenameDialog = compose<RenameProps, PresetsDialogsProps & { dialog: RenameProps["dialog"]; name0: string }>(
  ...withForm((p: { name0: string }) => p.name0),
  withHandlers<PresetsDialogsProps & { dialog: RenameProps["dialog"] } & FormState, { onSubmit: (e: FormEvent) => void }>({
    onSubmit: (p) => (e: FormEvent) => {
      e.preventDefault()
      const name = p.name.trim()
      if (!name) return p.setError("Give it a name.")
      void submit(p, () => p.onRename(p.dialog.preset, p.dialog.id, name))
    },
  }),
)(RenameView)

// Delete -------------------------------------------------------------------------

interface DeleteState {
  busy: boolean
  setBusy: (v: boolean) => void
}
type DeleteProps = PresetsDialogsProps & { dialog: { kind: "delete"; preset: PresetKind; id: string }; name: string } & DeleteState & { onConfirm: () => void }

function DeleteView(p: DeleteProps) {
  return (
    <Shell dialog={p.dialog} onClose={p.onClose} confirm title={`Delete ${p.name}?`} description={`The ${p.dialog.preset} is removed from Strand. The lights don't change.`}>
      <DialogFooter>
        <CancelButton />
        <Button type="button" variant="destructive" disabled={p.busy} onClick={p.onConfirm}>
          {p.busy ? <Spinner /> : null}
          Delete
        </Button>
      </DialogFooter>
    </Shell>
  )
}

const DeleteDialog = compose<DeleteProps, PresetsDialogsProps & { dialog: DeleteProps["dialog"]; name: string }>(
  withState("busy", "setBusy", false),
  withHandlers<PresetsDialogsProps & { dialog: DeleteProps["dialog"]; name: string } & DeleteState, { onConfirm: () => void }>({
    onConfirm: (p) => async () => {
      p.setBusy(true)
      if (await p.onDelete(p.dialog.preset, p.dialog.id, p.name)) return p.onClose()
      p.setBusy(false)
    },
  }),
)(DeleteView)

/** The preset a rename or delete names, from its list. */
const presetOf = (p: PresetsDialogsProps, preset: PresetKind, id: string): Scene | LookRecord | undefined =>
  (preset === "scene" ? p.scenes : p.looks).find((x) => x.id === id)

/** The Presets tab's open dialog. A dialog whose scene or look is gone renders nothing. */
export function PresetsDialogs(props: PresetsDialogsProps) {
  const d = props.dialog
  switch (d.kind) {
    case "saveScene":
      return <SaveSceneDialog {...props} />
    case "saveLook":
      return <SaveLookDialog {...props} />
    case "applyLook": {
      const look = props.looks.find((l) => l.id === d.id)
      return look ? <ApplyLookDialog {...props} look={look} /> : null
    }
    case "sceneWarn": {
      const scene = props.scenes.find((s) => s.id === d.id)
      return scene ? <SceneWarnView {...props} scene={scene} /> : null
    }
    case "rename": {
      const p = presetOf(props, d.preset, d.id)
      return p ? <RenameDialog {...props} dialog={d} name0={p.name} /> : null
    }
    case "delete": {
      const p = presetOf(props, d.preset, d.id)
      return p ? <DeleteDialog {...props} dialog={d} name={p.name} /> : null
    }
  }
}
