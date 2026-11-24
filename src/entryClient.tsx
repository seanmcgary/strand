import "@/lib/reactCompat"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { Provider } from "react-redux"
import { createBrowserRouter, RouterProvider } from "react-router-dom"
// NOTE: CSS is loaded via a <link rel="stylesheet"> in index.html (not a JS
// import here) so styles are render-blocking in <head> — no flash of unstyled
// content. The fonts are pulled in from src/index.css.
import { makeStore, reducers } from "@/store"
import { routes } from "@/router"

const store = makeStore(reducers)
const router = createBrowserRouter(routes)

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Provider store={store}>
      <RouterProvider router={router} />
    </Provider>
  </StrictMode>,
)
