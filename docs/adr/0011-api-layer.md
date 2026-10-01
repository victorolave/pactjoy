# ADR-0011: API layer: `packages/api` behind a thin Supabase Edge shell

- **Status:** Proposed
- **Date:** 2026-10-01
- **Deciders:** Victor Olave

## Context

`packages/app` exposes 18 use cases behind ports (ADR-0008) and `packages/db` implements them on Postgres (ADR-0010). The next step is the HTTP surface the PWA talks to, without letting Supabase or any other vendor leak into the domain or the use cases (CLAUDE.md, high decoupling). The runtime is a Supabase Edge Function (Deno), which has three consequences that shape the design: it cannot run NestJS, its import resolution for code outside the function directory is unverified, and a dead database connection can kill the worker instead of raising a catchable error.

Product questions Q1 to Q8 (account deletion, read models, display names, `config push`, CORS origins, signup policy, status-code semantics, owner visibility of private commitments) are open. The design isolates each of them to one place so that answering them later changes a table or a flag, not the structure.

## Decision

Status: this ADR is a draft. Every item below is a proposal until the slices that implement it land and the import spike (S0) is recorded in the "Spike results" section.

- Proposed: **Package split.** A new workspace package `packages/api` holds the router, auth guard, validation, error mapping, presenters and composition helpers. It is standard TypeScript/ESM over Web `Request`/`Response`, tested in Node. `supabase/functions/api/index.ts` is a Deno composition root of about 30 lines and the only Supabase-aware code. `packages/api` does NOT depend on `@pactjoy/db`: Postgres is wired only in the shell, which keeps the turbo graph acyclic so `packages/db/test` can devDepend on `@pactjoy/api` for the HTTP-over-Postgres test. Enforced by Biome (`noRestrictedImports`, `noRestrictedGlobals`, `noNodejsModules`) plus a source scan in `packages/api/test/boundary.test.ts`.
- Proposed: **Import strategy.** The shell has its own `deno.json` import map that points `@pactjoy/*` at `packages/*/src/index.ts`, with `npm:` versions that must equal the pnpm lockfile (checked by a test). Packages stay free of `npm:`, `jsr:` and `Deno`. Fallbacks if the spike fails, where only the shell or the map changes: F1, copy `packages/*/src` into a gitignored `supabase/functions/_vendor/` before deploy; F2, bundle the shell into one file. Both contradict ADR-0007's preference for no build step only for deploy packaging.
- Proposed: **Router.** Hand-written, routes as data, a configurable base path (default `/api`). Construction throws on duplicate params or same-shape routes, so there is no precedence to reason about. Hono is the documented swap.
- Proposed: **Auth.** In-code JWT verification through a `TokenVerifier` port, implemented by a jose + remote JWKS adapter that lives in exactly one file (`src/adapters/jose-token-verifier.ts`). ES256 and RS256 only; `iss`, `aud=authenticated`, `role=authenticated`, a uuid `sub`; anonymous users rejected. The function is deployed with `verify_jwt = false`, because the gateway gives no envelope or CORS on 401. Every rejection is a uniform 401 (no oracle); an unreachable JWKS is a 503.
- Proposed: **Envelope and status map.** `{ data }` on success, `{ error: { code, message, details? } }` on failure, where `code` is the app error kind verbatim. The status map is exhaustive at compile time (`satisfies Record<AppErrorKind, ...>`) and a scan test fails if the app exports a new `*Error` union the API does not list. Provisional under Q7.
- Proposed: **Presenters.** The JSON boundary: Fractions as exact decimal strings, Instants as ISO-8601 UTC, no BigInt, never `userId` or `requestFingerprint`. Season responses are viewer-agnostic and conservative: a private commitment is hidden for everyone, including its owner, until a viewer-aware read model exists (Q2, Q8). Entry notes are emitted raw only because every entry response is the actor's own entry. **Requirement:** any future endpoint that returns another member's entry MUST go through `visibleNote`; the entry presenter must not be reused for that case as is.
- Proposed: **Composition.** `createApi(deps, options)` takes ports only and reads no environment. `createLazyHandler` builds once per isolate and memoizes; a failed build answers 503 and is retried on the next request. `loadApiEnv` reads configuration through an injected getter. Building opens no connection.
- Proposed: **Database-unavailable gotcha.** A connect failure (DNS, refused) kills the Edge worker and surfaces as an empty 503 with no CORS headers, which a browser sees as a network error. Catchable failures go through an injected `isUnavailable` predicate exported by `@pactjoy/db`, so no SQLSTATE knowledge lives in the API. Clients retry; `recordEntry` is safe through `clientRequestId` and the other writes are guarded by versions.

### Spike results

To be filled by slice C8 after the import spike (S0): the real pathname prefix for `serve` and `deploy`, local `SUPABASE_URL` against the token `iss`, out-of-tree import resolution on deploy, and whether `import_map` accepts `deno.json`.

## Alternatives considered

### Put jose and the Postgres wiring in the Deno shell

- **Pros:** the shell is the only place that knows Supabase.
- **Cons:** the most security-critical code (token verification) would get `deno check` only, never behavioural tests.
- **Why rejected:** the decoupling rule is "vendors only in adapters". `packages/api` is itself the driving adapter layer, and jose sits behind a port in one file enforced by lint and a scan. Postgres is the opposite case: wiring it in `packages/api` would create a turbo cycle with the db test, so it stays in the shell.

### Hono (or another framework) as the router

- **Pros:** mature, less code to own.
- **Cons:** a vendor in the core, harder to make route coverage exhaustive, an `npm:` import in Deno.
- **Why rejected:** about 120 lines of data-driven router with ambiguity rejected at construction is cheaper than the dependency. Hono remains the documented swap.

### Validation library (zod, valibot)

- **Pros:** less code.
- **Cons:** another vendor in the core.
- **Why rejected:** the API only validates structure and identifier formats; free text is owned by the app. Hand-written combinators are enough.

### Gateway JWT check (`verify_jwt = true`) or `getUser` per request

- **Pros:** no JWT code; `getUser` also detects revocation.
- **Cons:** the gateway returns neither the envelope nor CORS on 401; `getUser` costs a network call per request.
- **Why rejected:** in-code JWKS verification keeps one error contract and no per-request round trip.

## Consequences

### Positive

- Swapping the runtime (for example to NestJS) replaces only the shell; the router, auth, validation and presenters move unchanged.
- Auth, routing and error mapping are covered by Node tests, not only by type checks.
- Each open product question maps to one place: Q5 is env, Q7 is one table, Q4 and Q6 are config flags, Q1 is a reserved route, Q3 (display names) is a presenter field: responses expose only identifiers until the question is answered, and adding names later touches the presenter and the read model, not the router or auth.

### Negative

- Owners see their own private commitments as hidden in season responses until a viewer-aware read model exists (Q8).
- The PWA has no read endpoints for circles, seasons or habits yet (Q2).
- Local development cannot use the default HS256 keys; asymmetric keys are required (`supabase gen signing-key`).
- A database outage at connect time is an empty 503 without CORS that the API cannot improve.

### Neutral

- The hosted Supavisor pooler, TLS and cold-start behaviour are still unverified and are checked once during the ops checklist.

## References

- [ADR-0007](0007-explicit-ts-import-extensions.md), [ADR-0008](0008-use-case-and-port-conventions.md), [ADR-0010](0010-postgres-adapter.md)
- SDD change `api-edge-function-auth` (design and tasks in the project's Engram memory)
