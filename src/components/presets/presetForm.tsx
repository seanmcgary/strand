import { CancelButton, Spinner } from "@/components/dialogShell"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { Icon } from "@/components/ui/icon"
import { FORM_DESCRIPTION, FORM_MESSAGE, INPUT, LABEL } from "@/lib/dialogStyles"

const SELECT =
  "flex h-10 w-full appearance-none items-center justify-between whitespace-nowrap rounded-md border border-input bg-background py-2 pl-3 pr-9 text-sm shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

export function NameField({ value, error, placeholder, onChange }: { value: string; error: string | null; placeholder?: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor="preset-name" className={LABEL}>
        Name
      </label>
      <input
        id="preset-name"
        className={INPUT}
        value={value}
        maxLength={64}
        placeholder={placeholder}
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? "preset-name-msg" : undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {error ? (
        <p id="preset-name-msg" role="alert" className={FORM_MESSAGE}>
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function SubmitFooter({ label, busy, reason }: { label: string; busy: boolean; reason?: string }) {
  return (
    <DialogFooter>
      <CancelButton />
      <Button type="submit" disabled={busy} reason={reason}>
        {busy ? <Spinner /> : null}
        {label}
      </Button>
    </DialogFooter>
  )
}

export function SelectField(p: { id: string; label: string; help?: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={p.id} className={LABEL}>
        {p.label}
      </label>
      <div className="relative w-full">
        <select id={p.id} className={SELECT} value={p.value} aria-describedby={p.help ? `${p.id}-desc` : undefined} onChange={(e) => p.onChange(e.target.value)}>
          {p.children}
        </select>
        <Icon name="chevron-down" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 opacity-60" />
      </div>
      {p.help ? (
        <p id={`${p.id}-desc`} className={FORM_DESCRIPTION}>
          {p.help}
        </p>
      ) : null}
    </div>
  )
}
