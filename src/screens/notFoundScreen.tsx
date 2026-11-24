// `compose(...)` runs at module-eval and touches `React.createFactory` under
// React 19 -- this shim must run first.
import "@/lib/reactCompat"
import { compose, lifecycle } from "recompose"
import { Link, NavigationType } from "react-router-dom"
import { withNavigationType, withRouter, type NavigationTypeProps, type RouterProps } from "@/lib/withRouter"

/**
 * The 404 page for any client route that matches nothing. Moves focus to
 * `<main>` only on a client-side arrival, never on the first document load.
 */
const SKIP_LINK =
  "sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-[60] focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"

const RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
const RING_ON_PAGE = `${RING} focus-visible:ring-offset-background`

interface NotFoundViewProps extends RouterProps, NavigationTypeProps {}

export function NotFoundScreenView(props: NotFoundViewProps) {
  const requestedPath = props.location.pathname
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <a href="#main" className={`${SKIP_LINK} ${RING_ON_PAGE}`}>
        Skip to content
      </a>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[640px] flex-1 flex-col items-start justify-center gap-4 px-6 focus:outline-none"
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5">
          <span className="size-[7px] rounded-full bg-primary" aria-hidden="true" />
          <span className="font-mono text-[11.5px] font-semibold tracking-[0.06em] text-muted-foreground">
            ERROR 404 · PAGE NOT FOUND
          </span>
        </div>
        <h1 className="text-balance text-[clamp(32px,6.6vw,52px)] font-extrabold leading-[1.03] tracking-[-0.035em]">
          We couldn&apos;t find that page.
        </h1>
        <p className="max-w-[460px] text-pretty leading-[1.55] text-muted-foreground">
          The address may be mistyped, or the page may have moved.
        </p>
        <div className="max-w-full overflow-hidden rounded-control border border-border bg-card px-3.5 py-2.5">
          <span className="font-mono text-[12px] text-muted-foreground">{requestedPath}</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link
            to="/"
            className={`inline-flex min-h-11 items-center rounded-[11px] bg-primary px-[22px] py-3 text-[15px] font-semibold text-primary-foreground hover:bg-primary/90 ${RING_ON_PAGE}`}
          >
            Back home
          </Link>
        </div>
      </main>
    </div>
  )
}

export default compose<NotFoundViewProps, Record<string, never>>(
  withRouter,
  withNavigationType,
  lifecycle<NotFoundViewProps, Record<string, never>, { _focusMoved?: boolean }>({
    componentDidMount() {
      // A CLIENT-SIDE navigation to a dead link swaps this screen in with no
      // focus move and nothing announced. Move focus to the same <main> the
      // skip link targets, but ONLY for that case.
      //
      // `NavigationType.Pop` is the bail, and it is load-bearing: react-router
      // seeds the very first document load as `Pop`, so this skips a typed or
      // bookmarked URL. Pop also covers back/forward, where the browser
      // restores focus and scroll itself.
      if (this.props.navigationType === NavigationType.Pop) return
      const main = typeof document !== "undefined" ? document.getElementById("main") : null
      if (main) main.focus()
    },
  }),
)(NotFoundScreenView)
