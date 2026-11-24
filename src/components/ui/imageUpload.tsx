import { Icon } from "@/components/ui/icon"
import { cn, FOCUS_RING_WITHIN } from "@/lib/utils"

/** Accepted MIME types for the file input, unless overridden via `accept`. */
export const DEFAULT_ACCEPT = "image/jpeg,image/png,image/webp"

export interface ImageUploadPhoto {
  /** Stable per-photo key. When set it's used as the list key so a thumbnail isn't remounted as its `previewUrl` fills in; consumers that don't track ids fall back to `previewUrl`+index. */
  id?: string
  previewUrl: string
  name: string
  /** Immediate-upload progress for this thumbnail — omitted/`undefined` renders no mask. `"preparing"` covers the window before `previewUrl` exists: the tile shows a neutral photo-icon placeholder until the preview is ready. */
  status?: "preparing" | "uploading" | "uploaded" | "error"
  /** True when this photo's `previewUrl` isn't actually renderable — renders a neutral "No preview" placeholder instead of a broken `<img>`. The file itself still uploads normally; this is purely a display concern. */
  noPreview?: boolean
}

export interface ImageUploadProps {
  id: string
  /** Overrides the dropzone's primary line of copy (default: "Drop photos here or click to browse"). */
  label?: string
  /** Overrides the file `accept` attribute (default: `DEFAULT_ACCEPT`). */
  accept?: string
  photos: ImageUploadPhoto[]
  onAdd: (files: File[]) => void
  onRemove: (index: number) => void
  className?: string
}

/**
 * Presentational dashed dropzone + 4-col thumbnail grid. Props-only, no hooks:
 * the drag handlers here are stateless — `onDragOver` only `preventDefault()`s
 * (so `onDrop` fires) and `onDrop` reads `e.dataTransfer.files` directly.
 *
 * This component NEVER calls `URL.createObjectURL` — doing so in render would
 * mint a fresh object URL on every render (a leak) with no hook available
 * here to revoke it. The consuming screen owns the whole object-URL
 * lifecycle: it creates each `previewUrl` once in its `onAdd` handler, stores
 * `{ file, previewUrl }` in form state, and revokes on remove and on
 * unmount/save.
 */
export function ImageUpload({ id, label, accept = DEFAULT_ACCEPT, photos, onAdd, onRemove, className }: ImageUploadProps) {
  const handleFiles = (fileList: FileList | null) => {
    const files = fileList ? Array.from(fileList) : []
    if (files.length > 0) onAdd(files)
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <label
        htmlFor={id}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          handleFiles(e.dataTransfer.files)
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1 rounded-[10px] border border-dashed border-stone-300 px-4 py-[18px] text-center transition-colors hover:border-brand hover:bg-green-50",
          FOCUS_RING_WITHIN,
        )}
      >
        <span className="text-[13px] font-semibold text-stone-700">
          {label ?? "Drop photos here or click to browse"}
        </span>
        <span className="text-[11.5px] font-medium text-stone-400">JPG, PNG, or WebP</span>
        <input
          type="file"
          id={id}
          accept={accept}
          multiple
          className="sr-only"
          onChange={(e) => {
            handleFiles(e.target.files)
            // Reset so selecting the same file(s) again still fires onChange.
            e.target.value = ""
          }}
        />
      </label>

      {photos.length > 0 ? (
        <ul className="grid grid-cols-4 gap-2">
          {photos.map((photo, index) => (
            <li
              key={photo.id ?? `${photo.previewUrl}-${index}`}
              className={cn(
                "relative aspect-square overflow-hidden rounded-[9px] border bg-stone-100",
                photo.status === "error" ? "border-red-300" : "border-stone-200",
              )}
            >
              {photo.status === "preparing" ? (
                <div className="flex size-full flex-col items-center justify-center gap-1 bg-stone-200 text-stone-400">
                  <Icon name="image" size={22} />
                </div>
              ) : photo.noPreview ? (
                <div className="flex size-full flex-col items-center justify-center gap-1 bg-stone-200 text-stone-400">
                  <span className="text-[9.5px] font-semibold">No preview</span>
                </div>
              ) : (
                <img src={photo.previewUrl} alt={photo.name} className="size-full object-cover" />
              )}
              {photo.status === "preparing" || photo.status === "uploading" ? (
                <div className="absolute inset-0 flex items-center justify-center bg-stone-900/40">
                  <span
                    aria-hidden="true"
                    className="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
                  />
                  <span className="sr-only">{photo.status === "preparing" ? "Preparing preview…" : "Uploading…"}</span>
                </div>
              ) : null}
              {photo.status === "error" ? (
                <div className="absolute inset-0 flex items-center justify-center bg-red-900/30">
                  <span className="rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-bold leading-none text-white">
                    Failed
                  </span>
                </div>
              ) : null}
              <button
                type="button"
                aria-label="Remove photo"
                onClick={() => onRemove(index)}
                className="absolute right-1 top-1 flex size-[22px] items-center justify-center rounded-md bg-stone-900/70 text-xs font-bold leading-none text-white transition-colors hover:bg-stone-900/90"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
