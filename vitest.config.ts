import path from "path";
import { defineConfig } from "vitest/config";

// Server tests and plain (non-component) `src/` unit tests. They run in Node
// (Fastify, no DOM) and are intentionally separate from the Vite config, so
// node tests do not load the React/Tailwind plugins.
const ciTimeoutMultiplier = process.env.CI ? 2 : 1;

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "src/**/*.test.{ts,tsx}"],
    testTimeout: 5_000 * ciTimeoutMultiplier,
    hookTimeout: 10_000 * ciTimeoutMultiplier,
  },
});
