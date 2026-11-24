import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "storybook/test"
import { Combobox, ComboboxView } from "@/components/ui/combobox"
import type { ComboboxItem } from "@/components/ui/combobox"

const RECENT_ITEMS: ComboboxItem[] = [
  { value: "recent-alice", label: "Alice", group: "Recent" },
  { value: "recent-bob", label: "Bob", group: "Recent" },
]

const DIRECTORY_ITEMS: ComboboxItem[] = [
  { value: "dir-carol", label: "Carol", group: "Directory" },
  { value: "dir-dave", label: "Dave", group: "Directory" },
]

// Renders the composed default export (real, self-managed open/query/active
// state) so these stories are driven by actual typing/focus in the canvas.
const meta = { title: "UI/Combobox", component: Combobox } satisfies Meta<typeof Combobox>
export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: { id: "combobox-empty", label: "Assignee", items: [], value: null, onSelect: fn() },
}

export const GroupedItems: Story = {
  args: {
    id: "combobox-grouped",
    label: "Assignee",
    items: [...RECENT_ITEMS, ...DIRECTORY_ITEMS],
    value: null,
    onSelect: fn(),
  },
}

export const WithCreateNew: Story = {
  args: {
    id: "combobox-create-new",
    label: "Assignee",
    items: [...RECENT_ITEMS, ...DIRECTORY_ITEMS],
    value: null,
    onSelect: fn(),
    onCreateNew: fn(),
    placeholder: "Search or add…",
  },
}

export const NoResults: Story = {
  args: {
    id: "combobox-no-results",
    label: "Assignee",
    items: [...RECENT_ITEMS, ...DIRECTORY_ITEMS],
    value: null,
    onSelect: fn(),
    alwaysShowCreateNew: true,
    noResultsText: "No match for that name.",
  },
}

// Renders the unconnected view in a fixed "open with a highlighted option"
// state via args, without real typing.
export const OpenWithActive: Story = {
  // `render` fully controls the output, but Storybook still requires `args`
  // (the ComboBox args are required by its Meta type); provide a minimal,
  // inert set — they are not rendered here.
  args: { id: "", label: "", items: [], value: null, onSelect: fn() },
  render: () => (
    <ComboboxView
      id="combobox-open"
      label="Assignee"
      items={[...RECENT_ITEMS, ...DIRECTORY_ITEMS]}
      value={null}
      onSelect={fn()}
      open
      query=""
      active={1}
      setOpen={fn()}
      setQuery={fn()}
      setActive={fn()}
      onInput={fn()}
      onFocus={fn()}
      onPick={fn()}
      onKeyDown={fn()}
      onBlur={fn()}
    />
  ),
}
