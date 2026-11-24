import "../src/lib/reactCompat"
import type { Preview } from "@storybook/react"
import { MemoryRouter } from "react-router-dom"
import React from "react"
import "@fontsource-variable/geist/index.css"
import "@fontsource-variable/geist-mono/index.css"
import "../src/index.css"

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "app",
      values: [
        { name: "app", value: "#f5f5f4" },
        { name: "raised", value: "#fafaf9" },
        { name: "white", value: "#ffffff" },
      ],
    },
  },
  decorators: [
    // ONE router for every story. React Router 7 throws "You cannot render a
    // <Router> inside another <Router>", so a story must never add its own --
    // it sets `parameters.routerEntries` instead.
    (Story, ctx) =>
      React.createElement(
        MemoryRouter,
        { initialEntries: (ctx.parameters.routerEntries as string[] | undefined) ?? ["/"] },
        React.createElement(Story),
      ),
  ],
}

export default preview
