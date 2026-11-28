import type { FormEvent } from "react"
import { compose, withHandlers, withState } from "recompose"
import type { Scene } from "../../../shared/apiTypes"
import { CancelButton, Spinner } from "@/components/dialogShell"
import { NameField, SubmitFooter } from "@/components/presets/presetForm"
import { submit, withForm, type FormState } from "@/components/presets/presetFormState"
import { Shell } from "@/components/presets/presetShell"
import type { PresetKind, PresetsDialogsProps } from "@/components/presets/presetsDialogTypes"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"

// Scene LED-count warning --------------------------------------------------------

export function SceneWarnView(p: PresetsDialogsProps & { scene: Scene }) {
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

export const RenameDialog = compose<RenameProps, PresetsDialogsProps & { dialog: RenameProps["dialog"]; name0: string }>(
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

export const DeleteDialog = compose<DeleteProps, PresetsDialogsProps & { dialog: DeleteProps["dialog"]; name: string }>(
  withState("busy", "setBusy", false),
  withHandlers<PresetsDialogsProps & { dialog: DeleteProps["dialog"]; name: string } & DeleteState, { onConfirm: () => void }>({
    onConfirm: (p) => async () => {
      p.setBusy(true)
      if (await p.onDelete(p.dialog.preset, p.dialog.id, p.name)) return p.onClose()
      p.setBusy(false)
    },
  }),
)(DeleteView)

