import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["tests/e2e/**", "node_modules/**", "dist/**", ".tmp/**", ".release/**"],
    fileParallelism: false,
    testTimeout: 15_000,
  },
});
