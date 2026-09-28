# ADR-0007: Explicit `.ts` extensions on relative imports

- **Status:** Accepted
- **Date:** 2026-09-28
- **Deciders:** Victor Olave

## Context

The stack (`CLAUDE.md`) commits to Supabase Edge Functions on Deno for the
API and to standard TypeScript/ESM for every shared package (`packages/engine`,
`packages/app`, `packages/db`), so those sources must run unmodified under
Vite/Vitest (bundler resolution), Node, and Deno. Deno's native ES module
loader and Node's ESM loader both resolve relative specifiers exactly as
written — no extension-probing, no `index.ts` shorthand — so an extensionless
relative import (`from "./commitment"`) that only a bundler can resolve would
break the moment `packages/app` or `supabase/functions` tries to import it
outside Vite. `packages/engine` was written before this constraint was
enforced, so all of its internal imports were extensionless.

## Decision

Every relative import, re-export, and dynamic `import()` in
`packages/engine`, `packages/app`, `packages/db`, and `supabase/functions`
MUST include an explicit `.ts` extension (e.g. `from "./commitment.ts"`).
This is enforced by Biome's `linter.rules.correctness.useImportExtensions`
rule (`level: "error"`, `forceJsExtensions: false`) configured at the repo
root in `biome.json`, so it applies to every package as each one comes
online — not just `packages/engine`. `tsconfig.base.json` sets
`allowImportingTsExtensions: true`, which is valid together with `noEmit`
and `moduleResolution: "Bundler"` and lets `tsc --noEmit` accept
`.ts`-suffixed relative specifiers without an extension-related error.

`packages/engine` was retrofitted mechanically with `biome lint --write`:
300 specifiers (299 static imports/exports plus one dynamic
`import("./index")` in `index.test.ts`) across 61 files were rewritten to
end in `.ts`. This was verified to be non-behavioral: `tsc --noEmit` stays
clean and all 356 existing tests (31 files) pass unchanged, including the
public-API pin test (`index.test.ts`), which still asserts the exact same
set of runtime exports — only the dynamic import specifier changed.

Deno resolution of the retrofitted import graph is **not** verified by this
change (no Deno runtime is installed in this environment); it is verified
empirically in change C (`supabase/functions`), per the design's "Verified
facts" section. This ADR's decision does not depend on that verification —
the same rule is required regardless of when Deno is exercised, because
Node's and bundlers' extensionless resolution would silently mask a Deno
incompatibility if the rule were skipped now.

## Alternatives considered

### Bundle every package before any non-Vite runtime imports it

- **Pros:** No source-level change needed; extensionless imports keep
  working everywhere because bundling always resolves them first.
- **Cons:** Adds a build step to a runtime (Deno Edge Functions) that is
  meant to load TypeScript sources directly with zero build tooling;
  duplicates the module graph in two forms (source and bundle) that can
  drift; defeats the point of sharing `packages/engine`/`packages/app`
  unmodified across runtimes (`CLAUDE.md`'s stated migration goal).
- **Why rejected:** Contradicts the explicit architecture rule that shared
  packages use "only standard TypeScript/ESM: nothing Deno- or
  Node-specific" and stay adapter-agnostic; a mandatory bundle step is
  itself a Node/tooling-specific dependency baked into the shared layer.

### Per-runtime import maps

- **Pros:** Source stays extensionless; each runtime gets its own mapping
  file translating specifiers to real paths.
- **Cons:** A second source of truth to keep in sync with the file tree by
  hand; import maps are a Deno/browser feature, not something Vitest or a
  plain `tsc --noEmit` honors without extra configuration; the failure mode
  (a stale map entry) is silent until the specific runtime is exercised.
- **Why rejected:** Adds an indirection layer exactly where the goal is "the
  same TypeScript sources... run unmodified" — an import map is itself a
  per-runtime adaptation, not a shared convention.

### Publish `packages/engine`/`packages/app` to npm and import as a package

- **Pros:** Package resolution (`node_modules`) handles extensions for you;
  a familiar pattern for sharing code across deployment targets.
- **Cons:** Introduces a publish/version/install cycle for code that changes
  on every commit during active development of a solo MVP; Deno's npm
  compatibility layer adds its own resolution quirks; massively
  disproportionate to the actual problem (missing file extensions).
- **Why rejected:** Wrong tool for a monorepo at this stage — pnpm workspace
  linking already gives instant cross-package visibility; publishing would
  remove that and add release overhead with no corresponding benefit.

### Emit `.js` and rely on `rewriteRelativeImportExtensions`

- **Pros:** TypeScript 5.7+'s `rewriteRelativeImportExtensions` lets sources
  keep `.ts` specifiers while the compiler rewrites them to `.js` on emit,
  which is the idiomatic path for packages that ship compiled output.
- **Cons:** Requires an emitting build (`noEmit: false`) for every package,
  which none of `packages/engine`/`packages/app`/`packages/db` currently
  need — Vite/Vitest/Deno/Node 24 (native TS type-stripping) all run the
  `.ts` sources directly; adding a build step here is unnecessary work for
  no consumer that currently needs compiled `.js`.
- **Why rejected:** Solves a problem this repo doesn't have yet (no package
  emits for external consumption); revisit if/when a package needs a real
  build output.

## Consequences

### Positive

- The same TypeScript sources in `packages/engine` (and, going forward,
  `packages/app`, `packages/db`, `supabase/functions`) resolve identically
  under Vite/Vitest, Node's native ESM/type-stripping loader, and Deno's
  ESM loader — no bundler-only shorthand anywhere in the shared layer.
- The rule is enforced repo-wide from `biome.json` at the root, so every
  future package inherits it automatically; a regression (a new
  extensionless relative import) fails `biome lint`/CI immediately instead
  of surfacing later as a runtime resolution error under Deno or Node.
- The retrofit was proven non-behavioral before merge: `tsc --noEmit` clean,
  all 356 pre-existing engine tests pass unchanged, and the public-API pin
  test (`index.test.ts`) confirms the exact same runtime export surface.

### Negative

- Every internal relative import now carries a `.ts` suffix, which is
  slightly more verbose than bundler-only extensionless imports and differs
  from common React/Node ecosystem convention (where `.js`, not `.ts`, is
  the emitted-extension norm).
- If a package later needs an emitting build for external consumption
  (npm publish, a compiled artifact), it will need
  `rewriteRelativeImportExtensions` or an explicit extension-rewrite step
  in its build, since the emitted output cannot literally contain `.ts`.

### Neutral

- Deno-native resolution of the retrofitted import graph is asserted by
  this ADR's reasoning but not yet empirically exercised in this
  environment (no local Deno install); it is verified for real once change
  C stands up `supabase/functions`. If that verification surfaces an
  unexpected Deno resolution quirk, it is a follow-up to this ADR, not a
  reason to have skipped the rule now.

## References

- `sdd/app-foundation/design` (#4812) — Architecture Decisions D1; "Verified
  facts" section with the exact Biome/TS/Vitest/Node measurements this ADR
  reports
- `sdd/app-foundation/spec/cross-runtime-imports` (#4814) — CRI-1..CRI-4
  scenarios this retrofit satisfies
- Root [`CLAUDE.md`](../../CLAUDE.md) — "Shared packages use only standard
  TypeScript/ESM: nothing Deno- or Node-specific"
