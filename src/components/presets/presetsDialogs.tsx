import type { LookRecord, Scene } from "../../../shared/apiTypes"
import { ApplyLookDialog } from "@/components/presets/applyLookDialog"
import { DeleteDialog, RenameDialog, SceneWarnView } from "@/components/presets/confirmDialogs"
import type { PresetKind, PresetsDialogsProps } from "@/components/presets/presetsDialogTypes"
import { SaveLookDialog, SaveSceneDialog } from "@/components/presets/saveDialogs"

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
