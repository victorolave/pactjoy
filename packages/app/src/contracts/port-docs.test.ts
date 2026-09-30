import { describe, expect, it } from "vitest";

// `import.meta.glob` is typed by the ImportMeta augmentation in no-vitest-in-testing.test.ts.
const SOURCES = import.meta.glob("../{circle,season}/*.repository.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** Port docs are the spec adapters are written from: the guard lock advice must match ADR-0010 (RC-S13). */
describe("guardVersion port docs", () => {
  it.each(["circle", "season"])(
    "%s repository names FOR NO KEY UPDATE and never advises FOR SHARE",
    (name) => {
      const doc = SOURCES[`../${name}/${name}.repository.ts`] ?? "";
      expect(doc).toContain("FOR NO KEY UPDATE");
      expect(doc.replaceAll(/never `?FOR SHARE`?/gi, "")).not.toMatch(/FOR SHARE/i);
      expect(doc).toMatch(/never `?FOR SHARE`?/i);
    },
  );

  it("circle repository documents the global invite-code uniqueness", () => {
    expect(SOURCES["../circle/circle.repository.ts"]).toMatch(/globally unique/i);
  });
});
