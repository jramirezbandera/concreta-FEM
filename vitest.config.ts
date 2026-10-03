import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "spike/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
