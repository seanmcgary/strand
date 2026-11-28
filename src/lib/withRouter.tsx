import type { ComponentType } from "react"
import { useLocation, useNavigate, useNavigationType, useParams } from "react-router-dom"
import type { Location, NavigateFunction, NavigationType, Params } from "react-router-dom"

/**
 * The only file in src/ allowed to import a React hook.
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
 * A separate HOC rather than a key on `RouterProps`, so that screens, stories
 * and tests that build `RouterProps` by hand do not need it.
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
