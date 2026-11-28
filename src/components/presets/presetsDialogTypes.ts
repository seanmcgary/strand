import type { LightsView, LookRecord, LookTarget, Scene } from "../../../shared/apiTypes"

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
