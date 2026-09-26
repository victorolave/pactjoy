# ADR-0003: Use Biome for linting and formatting

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Victor Olave

## Context

ADR-0002 bootstrapped the monorepo with ESLint (`typescript-eslint`,
type-aware) for linting and Prettier for formatting — two tools, two config
files (`eslint.config.js`, `.prettierrc.json`/`.prettierignore`), plus a root
`tsconfig.json` that existed only so `eslint.config.js` itself could
type-check under Node.

That setup also forced an unwanted coupling: `typescript-eslint@8.70.1`'s
peer dependency is `typescript: ">=4.8.4 <6.1.0"`, so `typescript` had to be
held at `~6.0.3` even though newer majors were available — a constraint on
the *language* driven entirely by a *linting* tool, tracked as a known
tradeoff in ADR-0002.

With only `packages/engine` in the repo today, and `packages/app`,
`packages/db` and `apps/web` still to come, this is the right time to
reconsider the toolchain before more packages accumulate config surface.

## Decision

Replace ESLint + Prettier with **Biome** (`@biomejs/biome`, pinned to
`2.5.14`) as the single linter and formatter, configured in one root
`biome.json`.

Consequences for the rest of the toolchain:

- `typescript-eslint`, `eslint`, `@eslint/js` and `prettier` are removed,
  along with `eslint.config.js`, `.prettierrc.json` and `.prettierignore`.
- The root `tsconfig.json` and the `@types/node` dependency are removed too
  — they existed solely so `eslint.config.js` (which imported
  `typescript-eslint` and used `import.meta.dirname`) could type-check under
  Node; with that file gone, nothing at the root needs Node types anymore.
- `typescript` is no longer pinned by a linter's peer range, so it is bumped
  to the latest major (`7.0.2`) — kept because `pnpm typecheck` passes
  cleanly with the existing strict `tsconfig.base.json`, `"types": []` still
  keeps `@types/node` out of `packages/engine`'s program, and Vitest (which
  transpiles via esbuild/Vite, not `tsc`) is unaffected by the TypeScript
  version used for the `typecheck` task.
- Each package's `lint` script runs `biome lint .`; the root `format` /
  `format:check` scripts run `biome format --write .` / `biome format .`;
  CI runs `biome ci .` (format + lint + import-order, read-only) in place of
  the old `format:check` step, still followed by
  `turbo run lint typecheck test`.
- `turbo.json`'s `globalDependencies` now lists `biome.json` instead of
  `eslint.config.js` / `.prettierrc.json`.

Biome has no Markdown formatter or linter in this version (verified against
its bundled `configuration_schema.json` — no `markdown` key anywhere), so
`biome.json`'s file matching doesn't need to special-case `.md` files:
Biome silently skips them, and `CLAUDE.md` / `README.md` / the ADRs keep
whatever formatting they already had.

## Alternatives considered

### Keep ESLint + Prettier

- **Pros:** Already working (ADR-0002); nothing to migrate; the largest
  rule/plugin ecosystem of any option here.
- **Cons:** Two tools, two config files, and — critically — the
  `typescript-eslint` peer range keeps `typescript` pinned below the latest
  major for as long as `typescript-eslint` lags behind. Slower on cold runs
  than Biome's Rust-based single binary.
- **Why rejected:** The TypeScript-version coupling is a real, recurring
  cost (already hit once in ADR-0002), and there's no forcing function to
  ever revisit it other than remembering to check back.

### ESLint (type-aware) + Biome as formatter only

- **Pros:** Keeps `typescript-eslint`'s type-aware lint rules (stronger than
  Biome's non-type-aware linter) while getting Biome's faster formatter and
  dropping Prettier.
- **Cons:** Still two tools and two configs; still keeps the exact
  `typescript-eslint` → `typescript` peer-range coupling this ADR exists to
  remove. Runs both a JS-based and a Rust-based tool in every `lint`/`format`
  pass.
- **Why rejected:** Doesn't solve the problem that motivated this ADR — the
  TypeScript pin comes from `typescript-eslint`, not from Prettier, so
  keeping ESLint at all keeps the coupling.

### oxlint

- **Pros:** Also Rust-based and fast; growing rule set; no bundled
  formatter, so it composes with Prettier or Biome's formatter.
- **Cons:** Less mature than Biome for this repo's needs — no first-party
  formatter (would still need a second tool), and no import-sorting/assist
  actions equivalent to Biome's `organizeImports`. Younger project with a
  smaller rule set than either ESLint or Biome today.
- **Why rejected:** Biome already covers linting *and* formatting *and*
  import organization in one binary with one config file; adding oxlint
  would still leave a second tool for formatting, which is the exact
  two-tools problem this ADR is trying to remove.

## Consequences

### Positive

- One tool, one config file (`biome.json`), replacing two tools and three
  config files (`eslint.config.js`, `.prettierrc.json`, `.prettierignore`)
  plus the root `tsconfig.json` that only existed to support the ESLint
  config.
- No more TypeScript-version coupling to a linter's peer dependency range —
  `typescript` moves to the latest major (`7.0.2`).
- Biome's single Rust binary is noticeably faster than the
  ESLint+`typescript-eslint`+Prettier combination, which matters as more
  packages (`packages/app`, `packages/db`, `apps/web`) are added.

### Negative

- Biome's linter is not type-aware the way `typescript-eslint`'s
  `recommendedTypeChecked` was — it can't catch rules that need type
  information (e.g. unsafe `any` assignments, floating promises). Mitigated
  by keeping `tsc --noEmit` as its own strict, mandatory `typecheck` task
  (unchanged by this ADR) and by the acceptance-test discipline in
  `packages/engine` (every worked example in the Mechanics page becomes a
  test) — type-aware lint rules were a secondary safety net, not the
  primary one.
- Biome's plugin/rule ecosystem is smaller than ESLint's; a rule this
  project later needs might not exist yet in Biome.

### Neutral

- Biome has no Markdown support in `2.5.14` — `.md` files are formatted
  exactly as before (untouched by this change).
- This is a tooling change to ADR-0002's monorepo setup, not a reversal of
  it: pnpm workspaces + Turborepo remain as decided there. See the note
  added to ADR-0002.

## References

- [ADR-0002](0002-monorepo-with-pnpm-workspaces-and-turborepo.md) — the
  ESLint + Prettier setup and the `typescript` pin this ADR replaces
- [Biome documentation](https://biomejs.dev/)
- [`typescript-eslint` peer dependencies](https://github.com/typescript-eslint/typescript-eslint) —
  `typescript: ">=4.8.4 <6.1.0"` as of `8.70.1`
