// End-to-end smoke test (`pnpm test:e2e`): the real engine behind the UI. Slow (it imports,
// analyses and renders real audio), so it is kept out of `pnpm test`.
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["e2e/**/*.e2e.tsx"],
    testTimeout: 400_000,
    hookTimeout: 180_000,
  },
});
