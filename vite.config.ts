import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);

// `vite build` bundles the SPA to dist/. `vite build --ssr server/server.ts
// --outDir dist-server` (the `build:server` script) builds the Fastify server
// for Node; `--ssr` there only means "build for Node", there is no server-side
// rendering. `vite`/`fastify`/`@fastify/*` stay external (required at runtime).
export default defineConfig(({ command, isSsrBuild }) => {
  // The `react` -> reactShim alias is ONLY needed for the production CLIENT
  // build: rolldown snapshots React's exports (via __toESM) before the
  // reactCompat side-effect shim runs, so recompose's `createFactory` import is
  // missing there. In dev (`serve`) and the server build, routing `react`
  // through the alias instead drags React's CJS entry into Vite's module
  // runner, which evaluates it as ESM and throws `module is not defined`. So we
  // alias react ONLY for the client prod build and everywhere else rely on the
  // reactCompat side-effect shim (which works in dev and vitest).
  const isClientProdBuild = command === "build" && !isSsrBuild;
  const alias: { find: string | RegExp; replacement: string }[] = [
    { find: "@", replacement: fileURLToPath(new URL("./src", import.meta.url)) },
  ];
  if (isClientProdBuild) {
    alias.push(
      // Give `react` a first-class `createFactory` export (removed in React 19,
      // still imported by recompose) — see src/reactShim.ts for rationale.
      { find: /^react$/, replacement: fileURLToPath(new URL("./src/reactShim.ts", import.meta.url)) },
      { find: /^__react_original$/, replacement: require.resolve("react") },
    );
  }
  return {
    // Root-relative asset URLs: the app is served at the root path of its host,
    // directly or behind a reverse proxy.
    base: "/",
    plugins: [react(), tailwindcss()],
    resolve: { alias },
    ssr: {
      external: ["vite", "fastify", "@fastify/static"],
    },
    build: isSsrBuild ? {} : { outDir: "dist" },
  };
});
