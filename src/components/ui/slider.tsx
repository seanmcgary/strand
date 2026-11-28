export interface SliderProps {
  value: number
  min?: number
  max?: number
  /** Runs on every `input` event while dragging. */
  onValueChange?: (value: number) => void
  /** Runs on the native `change` event: on release, or on each key press. */
  onValueCommit?: (value: number) => void
  "aria-label": string
  id?: string
  disabled?: boolean
}

/**
 * The design's slider: a transparent native `input type="range"` over a styled
 * track, range and thumb. A native listener carries `change`, because React's
 * `onChange` fires on every `input`.
 */
export function Slider({
  value,
  min = 1,
  max = 255,
  onValueChange,
  onValueCommit,
  "aria-label": ariaLabel,
  id,
  disabled,
}: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100
  return (
    <div className="relative flex w-full touch-none select-none items-center py-2">
      <input
        type="range"
        id={id}
        min={min}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        onChange={(e) => onValueChange?.(Number(e.currentTarget.value))}
        ref={(el) => {
          if (!el || !onValueCommit) return
          const commit = () => onValueCommit(Number(el.value))
          el.addEventListener("change", commit)
          return () => el.removeEventListener("change", commit)
        }}
      />
      <span className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-secondary peer-disabled:opacity-50">
        <span className="absolute h-full bg-primary" style={{ width: `${pct}%` }} />
      </span>
      <span
        className="pointer-events-none absolute top-1/2 block h-5 w-5 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:opacity-50"
        style={{ left: `calc(${pct}% - ${(pct / 100) * 20}px)` }}
      />
    </div>
  )
}
