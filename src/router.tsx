import type { RouteObject } from "react-router-dom"
import HomeScreen from "@/screens/homeScreen"
import NotFoundScreen from "@/screens/notFoundScreen"

/** The client routes. The last entry is the catch-all 404 page. */
export const routes: RouteObject[] = [
  { index: true, element: <HomeScreen /> },
  { path: "*", element: <NotFoundScreen /> },
]
