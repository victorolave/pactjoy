# ADR-0002: Monorepo with pnpm workspaces and Turborepo

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Victor Olave

**Note (2026-09-26):** the ESLint + Prettier tooling and the resulting
`typescript` pin described below are superseded by
[ADR-0003](0003-use-biome-for-linting-and-formatting.md). The pnpm
workspaces + Turborepo decision itself is unaffected and still stands.

## Context

`CLAUDE.md` already commits PactJoy to a TypeScript monorepo managed with
pnpm workspaces (decided 2026-09-24), with a hexagonal layout that will grow
into `packages/engine`, `packages/app`, `packages/db`, `supabase/functions`
and `apps/web`. Today only `packages/engine` exists. As the other packages
are added, the monorepo needs a way to run `lint`, `typecheck` and `test`
across packages without re-running work that hasn't changed, and to keep
that fast as `packages/app` starts depending on `packages/engine`.

Internal packages are consumed as TypeScript source directly (no build step)
via `"exports": { ".": "./src/index.ts" }` — there is nothing to compile yet,
so the only pipeline concern for now is _running and caching_ `lint` /
`typecheck` / `test`, not bundling.

## Decision

Use **pnpm workspaces** for package management and **Turborepo** to
orchestrate and cache the `lint`, `typecheck` and `test` tasks across
packages, declared in a root `turbo.json`. There is no `build` task yet,
since packages export TypeScript source directly; `turbo.json` will grow a
`build` task only when a package (e.g. `apps/web`) actually needs one.

Turborepo's remote cache is not enabled now — local caching is enough with a
single contributor and one package.

## Alternatives considered

### pnpm workspaces alone, no task runner

- **Pros:** One less tool and config file; sufficient today since there is
  only one package to lint/typecheck/test.
- **Cons:** No task caching or dependency-aware pipelines; running
  `lint`/`typecheck`/`test` across every package means re-running all of
  them every time, with no incremental benefit as packages are added. CI
  would need to be retrofitted with a task runner later anyway once
  `packages/app` and `apps/web` exist and start depending on each other.
- **Why rejected:** Adopting Turborepo now, while the surface area is small,
  costs one config file and avoids a disruptive retrofit later.

### Nx

- **Pros:** More powerful task graph, generators, and plugins for many stacks.
- **Cons:** Heavier; imposes its own project structure, generators and
  conventions (`nx.json`, project graph, plugin ecosystem) that this
  hand-rolled hexagonal layout doesn't need.
- **Why rejected:** More tool than the problem calls for. PactJoy's packages
  are plain TypeScript with no build step; Turborepo's simpler task-caching
  model is a closer fit.

### npm or yarn workspaces

- **Pros:** No extra dependency beyond the package manager itself.
- **Cons:** pnpm was already chosen as the package manager (`CLAUDE.md`,
  decided 2026-09-24) for its strict `node_modules` (no phantom dependencies)
  and installation speed; switching package managers just for workspaces
  would contradict that decision.
- **Why rejected:** Not a real alternative — pnpm workspaces is the natural
  continuation of the already-decided package manager.

## Consequences

### Positive

- `lint`, `typecheck` and `test` are cached and only re-run for packages
  whose inputs changed, which will matter as `packages/app`, `packages/db`
  and `apps/web` are added.
- Task pipelines can express dependencies between packages (e.g.
  `packages/app` typechecking after `packages/engine`) without hand-written
  shell scripts.
- Demonstrates a standard, recognizable monorepo setup for portfolio readers.

### Negative

- One more tool and config file (`turbo.json`) to maintain, with limited
  payoff today while only `packages/engine` exists.
- `typescript` is held at `~6.0.3` (not the newest major) because
  `typescript-eslint@8.70.1`'s peer range is `typescript: ">=4.8.4 <6.1.0"` —
  the next TypeScript major (7.x) is already published but unsupported by
  typescript-eslint. Revisit this pin (and the `~6.0.3` constraint in
  `package.json`) once typescript-eslint widens its peer range.

### Neutral

- Turborepo does not decide how Supabase Edge Functions (Deno runtime) will
  import workspace packages (import map vs. relative paths) — that remains
  open, as noted in `CLAUDE.md`, and will be its own ADR when the `api`
  function is built in Phase 2.
- Remote caching is available but intentionally not enabled now; revisit if
  CI build times or multi-contributor caching become relevant.

## References

- [`CLAUDE.md`](../../CLAUDE.md) — Stack and Architecture sections
- [Turborepo documentation](https://turborepo.com/docs)
