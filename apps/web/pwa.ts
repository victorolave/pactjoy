import type { VitePWAOptions } from "vite-plugin-pwa";
import { GLOB_PATTERNS } from "./src/sw/shell-config.ts";

/**
 * The installable shell (WF-R7, ADR-0012). Read by vite.config.ts and by the PWA test. The API is
 * cross-origin and never cached: the worker (src/sw.ts) has no runtime caching, and its navigation
 * fallback refuses any API path. Icons are neutral placeholders until the owner decides on brand
 * imagery (P5).
 */

/** The cream design token (--pj-cream). A test checks it against the vendored colors.css. */
const CREAM = "#FFF9F2";

export const pwaOptions: Partial<VitePWAOptions> = {
  registerType: "autoUpdate",
  devOptions: { enabled: false },
  manifest: {
    name: "PactJoy",
    short_name: "PactJoy",
    lang: "es",
    // Placeholder copy (P8): without it the plugin would publish package.json's developer description.
    description: "Tus hábitos, con tu círculo.",
    display: "standalone",
    start_url: "/",
    theme_color: CREAM,
    background_color: CREAM,
    icons: [
      { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  },
  // A hand-written worker (ADR-0017) for Web Push; it keeps the precache and the navigation
  // fallback of the generated one (src/sw/shell-config.ts holds the shared values).
  strategies: "injectManifest",
  srcDir: "src",
  filename: "sw.ts",
  injectManifest: { globPatterns: GLOB_PATTERNS },
};
