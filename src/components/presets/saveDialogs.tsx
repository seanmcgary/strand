import type { FormEvent } from "react"
import { compose, withHandlers, withState } from "recompose"
import { NameField, SelectField, SubmitFooter } from "@/components/presets/presetForm"
import { submit, withForm, type FormState } from "@/components/presets/presetFormState"
import { Shell } from "@/components/presets/presetShell"
import type { PresetsDialogsProps } from "@/components/presets/presetsDialogTypes"
import { patternText } from "@/lights/model"

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

export const SaveSceneDialog = compose<SceneProps, PresetsDialogsProps>(
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

const LOOK_HELP = "Ranges with painted LEDs can't be saved as a look."

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
        <SelectField id="look-range" label="Range" value={p.target} onChange={p.setTarget} help={LOOK_HELP}>
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
        <SubmitFooter label="Save look" busy={p.busy} reason={p.target ? undefined : LOOK_HELP} />
      </form>
    </Shell>
  )
}

export const SaveLookDialog = compose<LookProps, PresetsDialogsProps>(
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

