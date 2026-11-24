import type { ComponentType } from "react"
import { useLocation, useNavigate, useNavigationType, useParams } from "react-router-dom"
import type { Location, NavigateFunction, NavigationType, Params } from "react-router-dom"

/**
 * THE ONLY file in web/src allowed to import a React hook.
 *
 * Every other component gets router access via this HOC instead of calling
 * `useLocation`/`useNavigate`/`useParams`/`useNavigationType` directly (see
 * CONVENTIONS.md "State management").
 */
export interface RouterProps {
  location: Location
  navigate: NavigateFunction
  params: Readonly<Params>
}

export function withRouter<P extends RouterProps>(
  Component: ComponentType<P>,
): ComponentType<Omit<P, keyof RouterProps>> {
  function WithRouter(props: Omit<P, keyof RouterProps>) {
    const location = useLocation()
    const navigate = useNavigate()
    const params = useParams()
    return <Component {...(props as P)} location={location} navigate={navigate} params={params} />
  }
  WithRouter.displayName = `withRouter(${Component.displayName || Component.name || "Component"})`
  return WithRouter
}

/**
 * How the current location was reached: `NavigationType.Push`/`Replace` for an
 * in-app navigation, `NavigationType.Pop` for the browser's back/forward
 * buttons AND for the very first document load (react-router seeds the history
 * action as `Pop` under `createBrowserRouter`).
 *
 * Deliberately a SEPARATE HOC rather than a fourth key on `RouterProps`: every
 * screen in the app spreads `RouterProps` into its own props interface, and a
 * dozen stories/tests hand-build those props as object literals, so a new
 * required key there would be a repo-wide churn for the benefit of one
 * consumer.
 */
export interface NavigationTypeProps {
  navigationType: NavigationType
}

export function withNavigationType<P extends NavigationTypeProps>(
  Component: ComponentType<P>,
): ComponentType<Omit<P, keyof NavigationTypeProps>> {
  function WithNavigationType(props: Omit<P, keyof NavigationTypeProps>) {
    const navigationType = useNavigationType()
    return <Component {...(props as P)} navigationType={navigationType} />
  }
  WithNavigationType.displayName = `withNavigationType(${Component.displayName || Component.name || "Component"})`
  return WithNavigationType
}
