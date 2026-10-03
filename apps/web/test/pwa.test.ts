import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pwaOptions } from "../pwa.ts";

/** The installable shell (WF-R7): a manifest, a precached shell, and nothing of the API cached. */

const WEB_ROOT = resolve(import.meta.dirname, "..");
const COLORS = readFileSync(join(WEB_ROOT, "src/design/vendor/colors.css"), "utf8");
const INDEX_HTML = readFileSync(join(WEB_ROOT, "index.html"), "utf8");

const token = (name: string): string => {
  const match = new RegExp(`--${name}:(#[0-9A-Fa-f]{6})`).exec(COLORS);
  if (match?.[1] === undefined) throw new Error(`token --${name} not found`);
  return match[1];
};

const manifest = pwaOptions.manifest;
if (manifest === false || manifest === undefined) throw new Error("the PWA needs a manifest");

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe("web app manifest", () => {
  it("installs as a standalone app called PactJoy", () => {
    expect(manifest.name).toBe("PactJoy");
    expect(manifest.short_name).toBe("PactJoy");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.lang).toBe("es");
    expect(manifest.description).toBe("Tus hábitos, con tu círculo.");
  });

  it("takes its colours from the cream token, not a copy that can drift", () => {
    expect(manifest.theme_color).toBe(token("pj-cream"));
    expect(manifest.background_color).toBe(token("pj-cream"));
    expect(INDEX_HTML).toContain(`name="theme-color" content="${token("pj-cream")}"`);
  });

  it("declares 192 and 512 icons and a maskable one, and every file exists at that size", () => {
    const icons = manifest.icons ?? [];
    const sizes = icons.map((icon) => `${icon.sizes}:${icon.purpose ?? "any"}`).sort();
    expect(sizes).toEqual(["192x192:any", "512x512:any", "512x512:maskable"]);
    for (const icon of icons) {
      const path = join(WEB_ROOT, "public", icon.src);
      expect(existsSync(path), icon.src).toBe(true);
      const [width, height] = (icon.sizes ?? "").split("x").map(Number);
      expect(pngSize(path)).toEqual({ width, height });
    }
  });

  it("links the home-screen icon for iOS, which ignores the manifest icons", () => {
    expect(INDEX_HTML).toMatch(/<link rel="apple-touch-icon" href="\/icons\/[^"]+\.png"/);
    expect(INDEX_HTML).toContain("viewport-fit=cover");
  });
});

describe("service worker (WF-R7)", () => {
  const workbox = pwaOptions.workbox ?? {};

  it("updates itself and does not register in dev", () => {
    expect(pwaOptions.registerType).toBe("autoUpdate");
    expect(pwaOptions.devOptions?.enabled).toBe(false);
  });

  it("precaches the shell and the fonts", () => {
    const patterns = (workbox.globPatterns ?? []).join(" ");
    for (const extension of ["js", "css", "html", "woff2", "svg", "png", "webmanifest"]) {
      expect(patterns, extension).toContain(extension);
    }
    expect(workbox.navigateFallback).toBe("/index.html");
  });

  it("never caches the API: no runtime caching, and no navigation fallback for it", () => {
    expect(workbox.runtimeCaching).toBeUndefined();
    const denied = (workbox.navigateFallbackDenylist ?? []).map((pattern) => pattern.source);
    expect(denied.some((source) => source.includes("functions"))).toBe(true);
    expect(denied.some((source) => source.includes("api"))).toBe(true);
    for (const path of ["/functions/v1/api/me/today", "/api/me/today"]) {
      expect((workbox.navigateFallbackDenylist ?? []).some((pattern) => pattern.test(path))).toBe(
        true,
      );
    }
    expect(
      (workbox.navigateFallbackDenylist ?? []).some((pattern) => pattern.test("/season")),
    ).toBe(false);
  });
});
