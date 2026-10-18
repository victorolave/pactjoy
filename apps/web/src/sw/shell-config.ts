/**
 * The installable shell (WF-R7, ADR-0012), shared by `pwa.ts` (the build) and `sw.ts` (the worker)
 * so the PWA test asserts the same values both use. The API is cross-origin and never cached:
 * there is no runtime caching, and the navigation fallback refuses any API path.
 */

/** What the build precaches: the shell and the fonts. */
export const GLOB_PATTERNS = ["**/*.{js,css,html,woff2,svg,png,webp,webmanifest}"];

/** Every in-app navigation offline falls back to the shell. */
export const NAVIGATE_FALLBACK = "/index.html";

/** Never served from the shell: the Edge Function paths. */
export const NAVIGATE_FALLBACK_DENYLIST: readonly RegExp[] = [/^\/functions\//, /^\/api\//];
