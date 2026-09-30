import { describe, expect, it } from "vitest";

declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { query: string; import: string; eager: true },
    ): Record<string, string>;
  }
}

/** Raw source of every module under `src/`, keyed `../<path>` relative to this directory. */
const SOURCES = import.meta.glob("../**/*.ts", { query: "?raw", import: "default", eager: true });

const IMPORT_SPECIFIER = /(?:from|import)\s+"([^"]+)"/g;

function normalize(path: string): string {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return parts.join("/");
}

/** Every module reachable from `entry` through relative imports, plus the bare specifiers it meets. */
function closure(entry: string): { modules: Set<string>; bare: Set<string> } {
  const modules = new Set<string>();
  const bare = new Set<string>();
  const pending = [normalize(entry)];
  while (pending.length > 0) {
    const current = pending.pop() as string;
    if (modules.has(current)) continue;
    modules.add(current);
    const directory = current.split("/").slice(0, -1).join("/");
    for (const [, specifier] of (SOURCES[`../${current}`] ?? "").matchAll(IMPORT_SPECIFIER)) {
      if (specifier?.startsWith(".")) pending.push(normalize(`${directory}/${specifier}`));
      else if (specifier) bare.add(specifier);
    }
  }
  return { modules, bare };
}

describe("@pactjoy/app entry points stay free of the contracts subpath (RC-S3)", () => {
  it.each(["index.ts", "testing/index.ts"])("%s never reaches vitest or contracts", (entry) => {
    const { modules, bare } = closure(entry);
    expect(modules.size).toBeGreaterThan(1);
    expect(bare.has("vitest")).toBe(false);
    expect([...modules].filter((module) => module.startsWith("contracts/"))).toEqual([]);
  });
});
