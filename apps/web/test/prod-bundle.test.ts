import { join } from "node:path";
import react from "@vitejs/plugin-react";
import { build, type Rollup } from "vite";
import { describe, expect, it } from "vitest";

/**
 * The dev-only Today gallery (src/dev) must not reach a production bundle: no scenario text, no
 * fake API, no fixtures. It is reached only through `loadDevToday` (config.ts), a lazy import directly under the literal
 * `import.meta.env.DEV`, which Vite replaces with `false` in a production build.
 */
async function bundle(mode: "production" | "development"): Promise<string> {
  // Vitest runs with NODE_ENV=test, which Vite would read as a non-production build.
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = mode;
  try {
    return await bundleFor(mode);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
}

async function bundleFor(mode: "production" | "development"): Promise<string> {
  const result = await build({
    root: join(import.meta.dirname, ".."),
    configFile: false,
    mode,
    logLevel: "silent",
    plugins: [react()],
    build: { write: false, minify: false, sourcemap: false },
  });
  const outputs = (Array.isArray(result) ? result : [result]) as Rollup.RollupOutput[];
  return outputs
    .flatMap((output) => output.output)
    .map((chunk) => (chunk.type === "chunk" ? chunk.code : String(chunk.source)))
    .join("\n");
}

const MARKERS = ["Todo registrado (15b)", "Día sin compromisos (15c)", "FakePactJoyApi"];

describe("the dev gallery stays out of production", () => {
  it("a production build contains none of it", async () => {
    const code = await bundle("production");
    expect(code).toContain("Cargando Hoy"); // the real app is there
    for (const marker of MARKERS) expect(code).not.toContain(marker);
  }, 120_000);

  it("a development build does include it, so the check above can fail", async () => {
    const code = await bundle("development");
    for (const marker of MARKERS) expect(code).toContain(marker);
  }, 120_000);
});
