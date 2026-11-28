import { compose, withHandlers, withState } from "recompose"
import type { Device, LightsView, Look, LookRecord, LookTarget, Scene, StrandView } from "../../../shared/apiTypes"
import type { PresetKind, PresetsDialog } from "@/components/presets/presetsDialogTypes"
import { PresetsDialogs } from "@/components/presets/presetsDialogs"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdownMenu"
import { Icon } from "@/components/ui/icon"
import { Skeleton } from "@/components/ui/skeleton"
import { applyLookId, applySceneId, hexOf, patternText, presetMenuId, SAVE_LOOK_ID, SAVE_SCENE_ID } from "@/lights/model"
import { cn } from "@/lib/utils"
import type { ThunkError } from "@/store/createApiThunk"
import type { DeviceLights } from "@/store/slices/lights"
import type { DevicePresets } from "@/store/slices/presets"

const CARD = "rounded-lg border bg-card text-card-foreground"
const PANEL_CENTER = "flex flex-col items-center gap-3 px-6 py-14 text-center"
const ROW = "flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3"
const NO_STRANDS = "There are no strands on this device."
const NO_STRAND = "This scene's strand isn't on the controller any more, or those strands aren't combined now."

type Unwrap = { unwrap: () => Promise<unknown> }

/** The store actions the Presets tab dispatches, bound by the device screen. */
export interface PresetsActions {
  loadPresets: (id: string) => unknown
  /** The save and rename calls reject with a `ThunkError` the dialog shows. */
  createScene: (a: { id: string; name: string; strandKey: string }) => Unwrap
  renameScene: (a: { id: string; sceneId: string; name: string }) => Unwrap
  createLook: (a: { id: string; name: string; strandKey: string; range: string }) => Unwrap
  renameLook: (a: { id: string; lookId: string; name: string }) => Unwrap
  applyLook: (a: { id: string; look: LookRecord; targets: LookTarget[] }) => Unwrap
  /** A delete rejects after it has toasted. */
  deleteScene: (a: { id: string; sceneId: string; name: string }) => Unwrap
  deleteLook: (a: { id: string; lookId: string; name: string }) => Unwrap
  applyScene: (a: { id: string; scene: Scene }) => unknown
}

export interface PresetsTabProps {
  device: Device
  /** Offline or rebooting: the tab shows the offline panel. */
  offline: boolean
  lights: DeviceLights
  presets: DevicePresets
  /** The selected strand, else the first one. */
  strand: StrandView | null
  actions: PresetsActions
}

interface LocalProps {
  dialog: PresetsDialog | null
  setDialog: (d: PresetsDialog | null) => void
}

interface HandlerProps {
  onRetry: () => void
  onClose: () => void
  onApplyScene: (scene: Scene) => void
  onApplySceneNow: (scene: Scene) => void
  onSaveScene: (name: string, strandKey: string) => Promise<string | null>
  onSaveLook: (name: string, strandKey: string, range: string) => Promise<string | null>
  onRename: (preset: PresetKind, id: string, name: string) => Promise<string | null>
  onApplyLook: (look: LookRecord, targets: LookTarget[]) => Promise<string | null>
  onDelete: (preset: PresetKind, id: string, name: string) => Promise<boolean>
}

type BaseProps = PresetsTabProps & LocalProps
type Props = BaseProps & HandlerProps

const strandOf = (v: LightsView, key: string): StrandView | undefined => v.strands.find((s) => s.key === key)

/** A scene's strand by name; a combination whose strands are gone by their default names. */
const strandLabel = (v: LightsView, key: string): string =>
  strandOf(v, key)?.name ?? key.split("+").map((k) => strandOf(v, k)?.name ?? `Strand ${Number(k.slice(1)) + 1}`).join(" + ")

function PresetsSkeleton() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading">
      {[0, 1].map((k) => (
        <div key={k} className="flex flex-col gap-3">
          <Skeleton className="h-5 w-24" />
          <div className={cn(CARD, "flex flex-col gap-4 p-4")}>
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      ))}
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return (
    <div className={cn(CARD, PANEL_CENTER, "border-dashed py-10")}>
      <Icon name="bookmark" className="size-5 text-muted-foreground" />
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
    </div>
  )
}

function SectionHead(p: { id: string; title: string; desc: string; buttonId: string; label: string; reason?: string; onClick: () => void }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 id={p.id} className="text-base font-semibold tracking-tight">
          {p.title}
        </h2>
        <p className="text-[13px] text-muted-foreground">{p.desc}</p>
      </div>
      <Button type="button" id={p.buttonId} variant="outline" size="sm" leadingIcon="plus" reason={p.reason} onClick={p.onClick}>
        {p.label}
      </Button>
    </div>
  )
}

function RowMenu(p: { preset: PresetKind; id: string; name: string; onRename: () => void; onDelete: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" id={presetMenuId(p.preset, p.id)} variant="ghost" size="icon-sm" className="shrink-0" aria-label={`${p.name} options`}>
          <Icon name="ellipsis" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={p.onRename}>
          <Icon name="pencil" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem className="text-danger" onSelect={p.onDelete}>
          <Icon name="trash-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function LookSwatches({ look }: { look: Look }) {
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center -space-x-1.5">
      {look.slots.slice(0, 4).map((s, i) => (
        <span key={i} className="h-5 w-5 rounded-full border border-foreground/15 ring-2 ring-card" style={{ background: hexOf(s.col[0]!) }} />
      ))}
    </span>
  )
}

const lookText = (look: Look): string => `${patternText(look.pattern)} · ${[...new Set(look.slots.map((s) => s.fxName))].join(", ")}`

function PresetsTabView(props: Props) {
  const { presets, lights } = props
  if (props.offline) {
    return (
      <div className={cn(CARD, PANEL_CENTER, "border-dashed py-12")}>
        <Icon name="wifi-off" className="size-5 text-muted-foreground" />
        <p className="font-medium">Presets are unavailable while the device is offline</p>
        <p className="max-w-sm text-sm text-muted-foreground">They&apos;ll load again as soon as it reconnects.</p>
      </div>
    )
  }
  const v = lights.view
  const { scenes, looks } = presets
  if (!v || !scenes || !looks) {
    const error: ThunkError | null = !v && lights.status === "error" ? lights.error : presets.status === "error" ? presets.error : null
    if (!error) return <PresetsSkeleton />
    return (
      <div className={cn(CARD, PANEL_CENTER, "py-12")}>
        <Icon name="triangle-alert" className="size-5 text-danger" />
        <p className="font-medium">Couldn&apos;t load presets</p>
        <p className="max-w-sm text-sm text-muted-foreground">{error.message}</p>
        <Button type="button" variant="outline" size="sm" leadingIcon="rotate-cw" onClick={props.onRetry}>
          Try again
        </Button>
      </div>
    )
  }
  const reason = v.strands.length ? undefined : NO_STRANDS
  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="scenes-h" className="flex flex-col gap-3">
        <SectionHead
          id="scenes-h"
          title="Scenes"
          desc="A strand's whole setup: ranges, patterns, colors, effects, power and brightness."
          buttonId={SAVE_SCENE_ID}
          label="Save scene…"
          reason={reason}
          onClick={() => props.setDialog({ kind: "saveScene" })}
        />
        {scenes.length ? (
          <ul className={cn(CARD, "divide-y")}>
            {scenes.map((sc) => {
              const st = strandOf(v, sc.strandKey)
              const busy = presets.applying.includes(sc.id)
              return (
                <li key={sc.id} className={ROW}>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate font-medium">{sc.name}</span>
                    <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
                      <span>{strandLabel(v, sc.strandKey)}</span>
                      <span aria-hidden="true">·</span>
                      <span>{sc.summary}</span>
                      {st && st.len !== sc.ledCount ? (
                        <Badge variant="warning">
                          <Icon name="triangle-alert" />
                          LED count changed
                        </Badge>
                      ) : null}
                    </span>
                  </div>
                  {st ? null : <Badge variant="danger">Strand not found</Badge>}
                  <Button
                    type="button"
                    id={applySceneId(sc.id)}
                    variant="outline"
                    size="sm"
                    leadingIcon={busy ? undefined : "play"}
                    reason={st ? undefined : NO_STRAND}
                    disabled={busy}
                    onClick={() => props.onApplyScene(sc)}
                  >
                    {busy ? <Icon name="loader-circle" className="motion-safe:animate-spin" /> : null}
                    Apply
                  </Button>
                  <RowMenu
                    preset="scene"
                    id={sc.id}
                    name={sc.name}
                    onRename={() => props.setDialog({ kind: "rename", preset: "scene", id: sc.id })}
                    onDelete={() => props.setDialog({ kind: "delete", preset: "scene", id: sc.id })}
                  />
                </li>
              )
            })}
          </ul>
        ) : (
          <Empty text="No scenes yet. Save the current strand setup to come back to it." />
        )}
      </section>
      <section aria-labelledby="looks-h" className="flex flex-col gap-3">
        <SectionHead
          id="looks-h"
          title="Looks"
          desc="A pattern with its colors and effects. It fits any range, whatever its length."
          buttonId={SAVE_LOOK_ID}
          label="Save look…"
          reason={reason}
          onClick={() => props.setDialog({ kind: "saveLook" })}
        />
        {looks.length ? (
          <ul className={cn(CARD, "divide-y")}>
            {looks.map((lk) => (
              <li key={lk.id} className={ROW}>
                <LookSwatches look={lk.look} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-medium">{lk.name}</span>
                  <span className="text-[13px] text-muted-foreground">{lookText(lk.look)}</span>
                </div>
                <Button type="button" id={applyLookId(lk.id)} variant="outline" size="sm" leadingIcon="play" onClick={() => props.setDialog({ kind: "applyLook", id: lk.id })}>
                  Apply to…
                </Button>
                <RowMenu
                  preset="look"
                  id={lk.id}
                  name={lk.name}
                  onRename={() => props.setDialog({ kind: "rename", preset: "look", id: lk.id })}
                  onDelete={() => props.setDialog({ kind: "delete", preset: "look", id: lk.id })}
                />
              </li>
            ))}
          </ul>
        ) : (
          <Empty text="No looks yet. Save a range's colors and effects to use them on any strand." />
        )}
      </section>
      {props.dialog ? (
        <PresetsDialogs
          dialog={props.dialog}
          view={v}
          scenes={scenes}
          looks={looks}
          selectedKey={props.strand?.key ?? v.strands[0]?.key ?? ""}
          onClose={props.onClose}
          onSaveScene={props.onSaveScene}
          onSaveLook={props.onSaveLook}
          onRename={props.onRename}
          onApplyLook={props.onApplyLook}
          onApplyScene={props.onApplySceneNow}
          onDelete={props.onDelete}
        />
      ) : null}
    </div>
  )
}

/** Runs a call that rejects with a `ThunkError`; resolves to its message, or null when it succeeded. */
async function refusal(call: Unwrap): Promise<string | null> {
  try {
    await call.unwrap()
    return null
  } catch (e) {
    return (e as ThunkError).message
  }
}

export const PresetsTab = compose<Props, PresetsTabProps>(
  withState("dialog", "setDialog", null),
  withHandlers<BaseProps, HandlerProps>({
    onRetry: (p) => () => {
      p.actions.loadPresets(p.device.id)
    },
    onClose: (p) => () => p.setDialog(null),
    onApplyScene: (p) => (scene: Scene) => {
      const st = p.lights.view?.strands.find((s) => s.key === scene.strandKey)
      if (!st) return
      if (st.len !== scene.ledCount) p.setDialog({ kind: "sceneWarn", id: scene.id })
      else p.actions.applyScene({ id: p.device.id, scene })
    },
    onApplySceneNow: (p) => (scene: Scene) => {
      p.actions.applyScene({ id: p.device.id, scene })
    },
    onSaveScene: (p) => (name: string, strandKey: string) => refusal(p.actions.createScene({ id: p.device.id, name, strandKey })),
    onSaveLook: (p) => (name: string, strandKey: string, range: string) => refusal(p.actions.createLook({ id: p.device.id, name, strandKey, range })),
    onRename: (p) => (preset: PresetKind, id: string, name: string) =>
      refusal(preset === "scene" ? p.actions.renameScene({ id: p.device.id, sceneId: id, name }) : p.actions.renameLook({ id: p.device.id, lookId: id, name })),
    onApplyLook: (p) => (look: LookRecord, targets: LookTarget[]) => refusal(p.actions.applyLook({ id: p.device.id, look, targets })),
    onDelete: (p) => async (preset: PresetKind, id: string, name: string) =>
      (await refusal(preset === "scene" ? p.actions.deleteScene({ id: p.device.id, sceneId: id, name }) : p.actions.deleteLook({ id: p.device.id, lookId: id, name }))) === null,
  }),
)(PresetsTabView)
