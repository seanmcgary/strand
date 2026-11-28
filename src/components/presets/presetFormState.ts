import { withState } from "recompose"
import type { PresetsDialogsProps } from "@/components/presets/presetsDialogTypes"

/** The form state every dialog with a name field shares. */
export interface FormState {
  name: string
  setName: (v: string) => void
  error: string | null
  setError: (v: string | null) => void
  busy: boolean
  setBusy: (v: boolean) => void
}
export const withForm = (initialName: (p: never) => string) => [
  withState("name", "setName", initialName),
  withState("error", "setError", null),
  withState("busy", "setBusy", false),
]

/** Runs a save that resolves to the server's message when it refuses; closes on success. */
export async function submit(p: PresetsDialogsProps & FormState, run: () => Promise<string | null>) {
  p.setBusy(true)
  const error = await run()
  if (error === null) return p.onClose()
  p.setBusy(false)
  p.setError(error)
}

