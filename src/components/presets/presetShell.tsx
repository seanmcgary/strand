import { DialogShell } from "@/components/dialogShell"
import type { PresetKind, PresetsDialog } from "@/components/presets/presetsDialogTypes"
import { applyLookId, applySceneId, presetMenuId, SAVE_LOOK_ID, SAVE_SCENE_ID } from "@/lights/model"

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


interface ShellProps {
  dialog: PresetsDialog
  onClose: () => void
  title: string
  description?: string
  /** A confirm dialog has no close button; Cancel is the first control. */
  confirm?: boolean
  initialFocus?: () => HTMLElement | null
  children?: React.ReactNode
}

export const Shell = ({ dialog, confirm, ...rest }: ShellProps) => (
  <DialogShell returnFocus={() => returnTarget(dialog)} showCloseButton={!confirm} {...rest} />
)
