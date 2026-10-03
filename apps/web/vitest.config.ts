import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: tests never load the PWA plugin.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "test/**/*.test.ts"],
  },
});
