import { describe, expect, it } from "vitest";

const SOURCES = import.meta.glob("../**/*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});

/**
 * The upload ledger and the object storage are confined to `src/entry-photo/` (ADR-0016, REQ-S1,
 * REQ-P3). A ledger row carries the object key and the reservation state, and an object key must
 * never reach a peer, so the rest of the app talks to this module's helpers (`verifyUploadedPhoto`,
 * `attachPhoto`, `releasePhoto`, `purgeReleased`, `photoViews`) and never to `repos.entryPhotos` or to
 * the `EvidenceStorage` methods. Only this module (and the adapter contract suites that exercise the
 * ports themselves) may touch them. The repository TYPE is also wired by the composition files in
 * `REPOSITORY_TYPE_HOMES`.
 */
const ALLOWED = [/^\.\/(?!\.)/, /^\.\.\/contracts\//];
const REPOSITORY_TYPE_HOMES = [
  /^\.\.\/ports\/repositories\.ts$/,
  /^\.\.\/index\.ts$/,
  /^\.\.\/testing\//,
];

const FORBIDDEN: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "repository handle", pattern: /\b(repos|tx|uow|app)\s*\.\s*entryPhotos\b/ },
  { name: "alias of entryPhotos", pattern: /=\s*[\w.?]*\.entryPhotos\s*[;,)\n]/ },
  {
    name: "destructured entryPhotos",
    pattern: /\{[^}]*\bentryPhotos\b[^}]*\}\s*=\s*(repos|app|tx|uow)\b/,
  },
  {
    name: "entryPhotos as a callback parameter",
    pattern: /\{[^}]*\bentryPhotos\b[^}]*\}\s*\)?\s*=>/,
  },
  {
    name: "ledger method call",
    pattern: /\bentryPhotos\s*\.\s*(getMany|countOpen|releaseExpired|listReleased|purge)\b/,
  },
  {
    name: "storage call",
    pattern: /\bevidence\s*\.\s*(signUpload|signDownloads|stat|readHead|delete)\s*\(/,
  },
];
const REPOSITORY_TYPE = /\bEntryPhotoRepository\b/;

const outside = (allowed: readonly RegExp[]) =>
  Object.entries(SOURCES).filter(([path]) => !allowed.some((a) => a.test(path)));

describe("the photo ledger and storage are used inside the entry-photo module only", () => {
  it("finds the source files it is meant to scan", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);
    expect(Object.keys(SOURCES)).toContain("./entry-photo.repository.ts");
  });

  it("no file outside src/entry-photo reaches the ledger or calls the storage port", () => {
    const offenders = outside(ALLOWED).flatMap(([path, source]) =>
      FORBIDDEN.filter(({ pattern }) => pattern.test(String(source))).map(
        ({ name }) => `${path}: ${name}`,
      ),
    );
    expect(offenders).toEqual([]);
  });

  it("only the composition files name the repository type", () => {
    const offenders = outside([...ALLOWED, ...REPOSITORY_TYPE_HOMES])
      .filter(([, source]) => REPOSITORY_TYPE.test(String(source)))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("the ledger port has exactly the reviewed methods (no season-wide or peer read)", () => {
    const port = String(SOURCES["./entry-photo.repository.ts"]);
    const methods = [...port.matchAll(/^\s{2}(\w+)\(/gm)].map((match) => match[1]);
    expect(methods).toEqual([
      "get",
      "getMany",
      "add",
      "save",
      "countOpen",
      "releaseExpired",
      "listReleased",
      "purge",
    ]);
  });

  it("the storage port has exactly the reviewed methods", () => {
    const port = String(SOURCES["../ports/evidence-storage.ts"]);
    const body = port.slice(port.indexOf("export interface EvidenceStorage {"));
    const methods = [...body.slice(0, body.indexOf("\n}\n")).matchAll(/^\s{2}(\w+)\(/gm)].map(
      (match) => match[1],
    );
    expect(methods).toEqual(["signUpload", "signDownloads", "stat", "readHead", "delete"]);
  });

  it.each([
    ["repository handle", "const rows = await repos.entryPhotos.get(id);"],
    ["repository handle", "await app.entryPhotos.add(photo);"],
    ["alias of entryPhotos", "const p = repos.entryPhotos;\np.get(id);"],
    ["destructured entryPhotos", "const { entryPhotos } = repos;"],
    ["entryPhotos as a callback parameter", "uow.read(({ entryPhotos }) => entryPhotos.get(id))"],
    ["entryPhotos as a callback parameter", "async ({ entries, entryPhotos }) => {"],
    ["ledger method call", "await entryPhotos.releaseExpired(null, now, 5);"],
    ["storage call", "const url = await deps.evidence.signUpload(key, object, 300, now);"],
    ["storage call", "await evidence.delete(key);"],
  ])("the %s pattern does catch %j (guards the guard)", (name, source) => {
    const hit = FORBIDDEN.find((f) => f.name === name);
    expect(hit?.pattern.test(source)).toBe(true);
  });

  it("does not flag data that merely mentions photos, or other aggregates' stores", () => {
    for (const source of [
      "const photo = view.photo;",
      "const { entry, photoId } = loaded.value;",
      "await repos.habits.get(id);",
      "deps.evidence satisfies EvidenceStorage;",
      "const views = await photoViews(repos, deps.evidence, ids, now);",
      "readonly evidence: EvidenceStorage;",
    ]) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(source))).toBe(false);
    }
  });
});
