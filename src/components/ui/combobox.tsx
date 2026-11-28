import { compose, withHandlers, withState } from "recompose"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * A generic WAI-ARIA combobox (a typeahead picker with optional grouping and
 * "create new" affordance), a domain-agnostic primitive. The item shape is deliberately generic —
 * a product can subtype `ComboboxItem` by attaching its own `group`/`meta`/
 * `badge` semantics (e.g. catalog category or membership badge).
 *
 * Where the state lives: this component self-manages its
 * open/query/active-descendant UI state via its OWN recompose chain
 * (`withState` — not a React hook, permitted for local UI state per
 * CONVENTIONS.md). It is NOT connected to the store; the caller supplies
 * `items` and `onSelect`/`onCreateNew`.
 *
 * `ComboboxView` is exported (unconnected) so a story can render fixed states
 * (e.g. dropdown open with a highlighted option) via args.
 */

export interface ComboboxItem {
  value: string
  label: string
  group?: string
  /** Optional second line rendered under `label`. */
  meta?: string
  /**
   * Optional pill rendered inline after `label` on the name line.
   * DELIBERATELY not matched by `filterItems` — badge text must never make an
   * otherwise-unmatched row searchable.
   */
  badge?: string
}

interface ComboboxGroup {
  group: string | undefined
  items: ComboboxItem[]
}

export type ComboboxRow = { kind: "item"; item: ComboboxItem } | { kind: "createNew"; text: string }

/** Matches against `label` AND `meta` (when set) — e.g. an item whose `meta` bakes in a category can be searched by that too. */
function filterItems(items: ComboboxItem[], query: string): ComboboxItem[] {
  const trimmed = query.trim().toLowerCase()
  if (trimmed === "") return items
  return items.filter(
    (item) => item.label.toLowerCase().includes(trimmed) || (item.meta?.toLowerCase().includes(trimmed) ?? false),
  )
}

/** Buckets items by `group`, preserving first-seen group order and each item's relative order within its group. */
function groupItems(items: ComboboxItem[]): ComboboxGroup[] {
  const order: (string | undefined)[] = []
  const buckets = new Map<string | undefined, ComboboxItem[]>()
  items.forEach((item) => {
    if (!buckets.has(item.group)) {
      buckets.set(item.group, [])
      order.push(item.group)
    }
    buckets.get(item.group)?.push(item)
  })
  return order.map((group) => ({ group, items: buckets.get(group) ?? [] }))
}

/**
 * Single source of truth for "what rows does this query produce" — used by
 * both the view (to render) and the handlers (to size keyboard-nav modulo
 * and resolve Enter-to-select), so the two can never disagree about what's on
 * screen.
 *
 * `alwaysShowCreateNew` is an opt-in (default off): when set, the create-new
 * footer row is shown whenever `allowCreateNew` is set and there's no exact
 * label match — even with an empty query / zero results.
 */
// eslint-disable-next-line react-refresh/only-export-components -- pure helper exported for reuse; not a component.
export function buildCombobox(items: ComboboxItem[], query: string, allowCreateNew: boolean, alwaysShowCreateNew = false) {
  const trimmed = query.trim()
  const groups = groupItems(filterItems(items, query))
  const orderedItems = groups.flatMap((group) => group.items)
  const hasExactMatch = orderedItems.some((item) => item.label.toLowerCase() === trimmed.toLowerCase())
  const showCreateNew = allowCreateNew && !hasExactMatch && (alwaysShowCreateNew || trimmed !== "")
  const rowCount = orderedItems.length + (showCreateNew ? 1 : 0)
  return { groups, orderedItems, showCreateNew, trimmed, rowCount }
}

// eslint-disable-next-line react-refresh/only-export-components -- pure helper exported for reuse; not a component.
export function rowAt(
  items: ComboboxItem[],
  query: string,
  allowCreateNew: boolean,
  alwaysShowCreateNew: boolean,
  index: number,
): ComboboxRow | undefined {
  if (index < 0) return undefined
  const { orderedItems, showCreateNew, trimmed } = buildCombobox(items, query, allowCreateNew, alwaysShowCreateNew)
  if (index < orderedItems.length) return { kind: "item", item: orderedItems[index]! }
  if (showCreateNew && index === orderedItems.length) return { kind: "createNew", text: trimmed }
  return undefined
}

export interface ComboboxProps {
  id: string
  /** REQUIRED — becomes the accessible name (`<label htmlFor>`); no anonymous combobox. */
  label: string
  items: ComboboxItem[]
  value: string | null
  onSelect: (value: string) => void
  onCreateNew?: (text: string) => void
  placeholder?: string
  /**
   * Opt-in (default false): always render the create-new footer action (see
   * `buildCombobox`) so the action stays reachable against a backing list
   * that's legitimately empty.
   */
  alwaysShowCreateNew?: boolean
  /** Opt-in: when set and there are zero matching items, render this message as an in-dropdown row. */
  noResultsText?: string
  /** Opt-in: overrides the default `Create new "{query}"` footer copy with a fixed label. */
  createNewLabel?: string
  /** Opt-in: a decorative icon (already `aria-hidden`) rendered before the create-new footer's label. */
  createNewIcon?: React.ReactNode
  /** Opt-in: a decorative icon (already `aria-hidden`) rendered inside the input, left-aligned. */
  leadingIcon?: React.ReactNode
  /** Opt-in: forwarded straight through to the underlying `<Input>`. */
  autoFocus?: boolean
}

interface ComboboxLocalState {
  open: boolean
  setOpen: (value: boolean) => void
  query: string
  setQuery: (value: string) => void
  active: number
  setActive: (value: number) => void
}

interface ComboboxHandlers {
  onInput: (e: React.ChangeEvent<HTMLInputElement>) => void
  onFocus: () => void
  onPick: (row: ComboboxRow) => void
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onBlur: () => void
}

export type ComboboxViewProps = ComboboxProps & ComboboxLocalState & ComboboxHandlers

/**
 * Pure render function — exported (unconnected) so the story can render fixed
 * states via args instead of driving it through real typing. All behavior
 * lives in the `withHandlers`/`withState` chain below; this component only
 * reads props. Same WAI-ARIA combobox contract as the old picker:
 * `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`,
 * a `role="listbox"`/`role="option"` popup, and the mousedown-guard-before-blur
 * mechanic on each option so a click can register before the input's blur
 * closes the list.
 */
export function ComboboxView(props: ComboboxViewProps) {
  const {
    id,
    label,
    items,
    onCreateNew,
    placeholder,
    open,
    query,
    active,
    onInput,
    onFocus,
    onPick,
    onKeyDown,
    onBlur,
    alwaysShowCreateNew,
    noResultsText,
    createNewLabel,
    createNewIcon,
    leadingIcon,
    autoFocus,
  } = props
  const listboxId = `${id}-listbox`
  const { groups, orderedItems, showCreateNew, trimmed, rowCount } = buildCombobox(
    items,
    query,
    Boolean(onCreateNew),
    Boolean(alwaysShowCreateNew),
  )
  const indexByItem = new Map<ComboboxItem, number>(orderedItems.map((item, index) => [item, index]))
  const showNoResults = orderedItems.length === 0 && Boolean(noResultsText)
  const showDropdown = open && (rowCount > 0 || showNoResults)
  const liveMessage = !open
    ? ""
    : orderedItems.length > 0
      ? `${orderedItems.length} result${orderedItems.length === 1 ? "" : "s"}`
      : (noResultsText ?? "No results")

  function renderOption(item: ComboboxItem) {
    const index = indexByItem.get(item)
    const isActive = index === active
    return (
      <li
        key={item.value}
        id={`${id}-opt-${index}`}
        role="option"
        aria-selected={isActive}
        // Prevent the input's blur (which would close this dropdown) from
        // firing before the click below registers — the standard combobox
        // mousedown guard.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onPick({ kind: "item", item })}
        className={
          isActive
            // `bg-brand/10` alone is 1.11:1 against the white listbox, so the
            // keyboard-active row had no PERCEPTIBLE indicator (WCAG 1.4.11
            // wants 3:1 for a state) -- only `aria-activedescendant` carried
            // it. The solid inset bar is 3.37:1, and being a box-shadow it
            // costs no layout, so arrowing through rows doesn't shift text.
            ? "flex cursor-pointer flex-col gap-0.5 bg-brand/10 px-3.5 py-2.5 shadow-[inset_3px_0_0_0_var(--color-brand)]"
            : "flex cursor-pointer flex-col gap-0.5 px-3.5 py-2.5 hover:bg-stone-50"
        }
      >
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 truncate text-[13.5px] font-semibold text-stone-900">{item.label}</span>
          {item.badge ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-brand-dark">
              {/* Decorative check icon — ui must not import from other component folders. */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <span>{item.badge}</span>
            </span>
          ) : null}
        </span>
        {item.meta ? <span className="font-mono text-[11.5px] text-stone-600">{item.meta}</span> : null}
      </li>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        {leadingIcon ? <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2">{leadingIcon}</span> : null}
        <Input
          id={id}
          role="combobox"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${id}-opt-${active}` : undefined}
          autoComplete="off"
          value={query}
          onChange={onInput}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          placeholder={placeholder}
          autoFocus={autoFocus}
          className={leadingIcon ? "pl-9" : undefined}
        />

        {showDropdown ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label={label}
            className="absolute inset-x-0 top-[calc(100%+6px)] z-10 max-h-64 overflow-auto rounded-control border border-stone-200 bg-white py-1 shadow-lg"
          >
            {groups.map((group) =>
              group.group ? (
                <li key={`group-${group.group}`} role="presentation">
                  <div className="px-3.5 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-stone-400">
                    {group.group}
                  </div>
                  <ul role="group" aria-label={group.group} className="contents">
                    {group.items.map((item) => renderOption(item))}
                  </ul>
                </li>
              ) : (
                group.items.map((item) => renderOption(item))
              ),
            )}
            {showNoResults ? <li role="presentation" className="px-3.5 py-2.5 text-[12.5px] font-medium text-stone-500">{noResultsText}</li> : null}
            {showCreateNew ? (
              <li
                id={`${id}-opt-${orderedItems.length}`}
                role="option"
                aria-selected={active === orderedItems.length}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick({ kind: "createNew", text: trimmed })}
                className={
                  active === orderedItems.length
                    ? "flex cursor-pointer items-center gap-2 bg-brand/10 px-3.5 py-2.5 text-[13px] font-semibold text-brand"
                    : "flex cursor-pointer items-center gap-2 px-3.5 py-2.5 text-[13px] font-semibold text-brand hover:bg-stone-50"
                }
              >
                {createNewIcon}
                {createNewLabel ?? `Create new "${trimmed}"`}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
      <div aria-live="polite" className="sr-only">
        {liveMessage}
      </div>
    </div>
  )
}

/**
 * `Combobox` self-manages its open/query/active-descendant UI state via its
 * OWN recompose chain (`withState` — not a React hook, permitted for local UI
 * state per CONVENTIONS.md). Handlers are split across TWO `withHandlers`
 * passes exactly like the old picker: a recompose `withHandlers` factory only
 * sees the props coming *into* that HOC, so `onKeyDown`/`onBlur` (which need
 * to call `onPick` for Enter-to-select) must be added in a second pass after
 * `onPick` is already on props.
 */
export const Combobox = compose<ComboboxViewProps, ComboboxProps>(
  withState("open", "setOpen", false),
  // Seeds the query from whichever item currently matches `value` — a one-time
  // seed, not a live sync.
  withState("query", "setQuery", (props: ComboboxProps) => {
    const selected = props.items.find((item) => item.value === props.value)
    return selected ? selected.label : ""
  }),
  withState("active", "setActive", -1),
  withHandlers<
    Omit<ComboboxViewProps, "onInput" | "onFocus" | "onPick" | "onKeyDown" | "onBlur">,
    Pick<ComboboxHandlers, "onInput" | "onFocus" | "onPick">
  >({
    onInput: (props) => (e) => {
      props.setQuery(e.target.value)
      props.setOpen(true)
      props.setActive(-1)
    },
    onFocus: (props) => () => {
      props.setOpen(true)
    },
    onPick: (props) => (row) => {
      if (row.kind === "createNew") {
        props.onCreateNew?.(row.text)
      } else {
        props.onSelect(row.item.value)
        props.setQuery(row.item.label)
      }
      props.setOpen(false)
      props.setActive(-1)
    },
  }),
  withHandlers<Omit<ComboboxViewProps, "onKeyDown" | "onBlur">, Pick<ComboboxHandlers, "onKeyDown" | "onBlur">>({
    // WAI-ARIA combobox keyboard map: ArrowDown/ArrowUp wrap through the
    // rendered rows (grouped items + the optional "create new" row), Enter
    // selects the active one via `onPick`, Escape closes.
    onKeyDown: (props) => (e) => {
      if (!props.open) return

      const { rowCount } = buildCombobox(props.items, props.query, Boolean(props.onCreateNew), Boolean(props.alwaysShowCreateNew))
      if (rowCount === 0) {
        if (e.key === "Escape") props.setOpen(false)
        return
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault()
          props.setActive((props.active + 1) % rowCount)
          break
        case "ArrowUp":
          e.preventDefault()
          props.setActive((props.active - 1 + rowCount) % rowCount)
          break
        case "Enter": {
          if (props.active < 0) break
          e.preventDefault()
          const row = rowAt(props.items, props.query, Boolean(props.onCreateNew), Boolean(props.alwaysShowCreateNew), props.active)
          if (row) props.onPick(row)
          break
        }
        case "Escape":
          props.setOpen(false)
          break
        default:
          break
      }
    },
    // Closes the dropdown — an option click still registers first via the
    // `onMouseDown` guard above.
    onBlur: (props) => () => {
      props.setOpen(false)
      props.setActive(-1)
    },
  }),
)(ComboboxView)
