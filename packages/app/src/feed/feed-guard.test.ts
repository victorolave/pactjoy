import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("./**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * The feed shows peers what happened, never the private material around it (ADR-0018, F16, REQ-X1).
 * So `src/feed/` must not reach reviews and SRBAI answers (ADR-0014), season-closure decisions
 * (ADR-0015, `closure-guard.test.ts`), the photo ledger (ADR-0016) or the free-text evidence of an
 * entry: not the stores, not their types, not their modules, not the `note` and `photoId`
 * properties, nor the privacy helpers that read them. Graduation comes from the closure module's
 * one public helper, `seasonGraduations` (the season's own `graduate` decisions and nothing else
 * of a closure): never `Habit.graduatedAt`, which says nothing about WHICH circle's close
 * graduated a reused habit. The feed calls the helper and never touches the closure store. Only the production sources are scanned: a test
 * may build an entry with a note precisely to prove it never leaks.
 *
 * The names are assembled from parts on purpose. The review, closure and photo guards scan every
 * file of the package for those exact names, and this file talks about all three: spelled out, it
 * would trip each of them.
 */
const join = (...parts: string[]) => parts.join("");
const REVIEWS = join("re", "views");
const CLOSURES = join("season", "Closures");
const PHOTOS = join("entry", "Photos");
const STORES = `(${REVIEWS}|${CLOSURES}|${PHOTOS})`;
const HANDLES = "(repos|tx|uow|app)";
const TYPES = [
  join("Review", "Repository"),
  join("SeasonClosure", "Repository"),
  join("EntryPhoto", "Repository"),
].join("|");

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  {
    name: "private repository handle",
    pattern: new RegExp(`\\b${HANDLES}\\s*\\.\\s*${STORES}\\b`),
  },
  {
    name: "destructured private repository",
    pattern: new RegExp(`\\{[^}]*\\b${STORES}\\b[^}]*\\}\\s*=\\s*${HANDLES}\\b`),
  },
  { name: "private repository type", pattern: new RegExp(`\\b(${TYPES})\\b`) },
  {
    name: "import of the review or photo modules",
    pattern: /from\s+["']\.\.\/(review|entry-photo)\//,
  },
  {
    name: "import of the closure module (only its calendar and graduations are allowed)",
    pattern: /from\s+["']\.\.\/season\/closure\/(?!season-calendar\.ts|season-graduations\.ts)/,
  },
  { name: "entry note", pattern: /\.\s*note\b/ },
  { name: "entry photo id", pattern: /\.\s*photoId\b/ },
  { name: "evidence helper", pattern: /\b(visibleNote|visiblePhotoId)\b/ },
];

const production = () =>
  Object.entries(SOURCES).filter(
    ([path]) => !path.endsWith(".test.ts") && !path.endsWith("-fixtures.ts"),
  );

describe("the feed never reaches private material", () => {
  it("finds the source files it is meant to scan", () => {
    const paths = production().map(([path]) => path);
    expect(paths).toContain("./derive-feed.ts");
    expect(paths).toContain("./feed-key.ts");
  });

  it("no production file of src/feed touches reviews, closures, photos, notes or photo ids", () => {
    const offenders = production().flatMap(([path, source]) =>
      FORBIDDEN.filter(({ pattern }) => pattern.test(String(source))).map(
        ({ name }) => `${path}: ${name}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("the feed record has no field for evidence, reflections or answers", () => {
    const record = String(SOURCES["./feed-record.ts"]);
    const fields = [...record.matchAll(/^\s+readonly (\w+)[?:]/gm)].map((match) => match[1]);
    expect(fields.length).toBeGreaterThan(10);
    const banned = /note|photo|reflection|srbai|answer|decision|objectKey|bucket/i;
    expect(fields.filter((field) => banned.test(String(field)))).toEqual([]);
  });

  it.each([
    ["private repository handle", `await repos.${REVIEWS}.list(a, b);`],
    ["private repository handle", `const rows = await tx.${CLOSURES};`],
    ["private repository handle", `app.${PHOTOS}.get(id)`],
    ["destructured private repository", `const { ${REVIEWS} } = repos;`],
    ["private repository type", `readonly store: ${join("Review", "Repository")};`],
    ["private repository type", `import type { ${join("EntryPhoto", "Repository")} } from "x";`],
    ["import of the review or photo modules", 'import { x } from "../review/period-summary.ts";'],
    ["import of the review or photo modules", "import { y } from '../entry-photo/photo-views.ts';"],
    [
      "import of the closure module (only its calendar and graduations are allowed)",
      'import { z } from "../season/closure/finalize.ts";',
    ],
    [
      "import of the closure module (only its calendar and graduations are allowed)",
      'import { z } from "../season/closure/season-closure.ts";',
    ],
    ["entry note", "const text = entry.note;"],
    ["entry photo id", "const id = entry\n  .photoId;"],
    ["evidence helper", "visibleNote(entry, commitment, viewer)"],
  ])("the %s pattern does catch %j (guards the guard)", (name, source) => {
    const hit = FORBIDDEN.find((f) => f.name === name);
    expect(hit?.pattern.test(source)).toBe(true);
  });

  it("does not flag what the feed legitimately uses", () => {
    for (const source of [
      'import { closeDatesOf } from "../season/closure/season-calendar.ts";',
      'import { seasonGraduations } from "../season/closure/season-graduations.ts";',
      "const graduations = await seasonGraduations(repos, season.id);",
      "const note = 'a word in a comment';",
      "photo: null",
      "const { entries } = world;",
    ]) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(source))).toBe(false);
    }
  });
});
