import { defineConfig } from "vitest/config";

// Pure tests only: no push service, no network (the sender takes an injected `fetch`).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
  },
});
