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

### Decisions taken during implementation

- Proposed: **Entry use cases return `memberId`.** `RecordEntryResult` and `EditEntryResult` carry the acting member's id, taken from the in-transaction member, and the API presents the entry with it. The earlier post-commit lookup was removed: it left a window where the entry was committed but the client got a 500, and the retry then got a 403 because `NotAMember` runs before the idempotent replay.
- Proposed: **Join body field.** `POST /circles/join` takes `{ "inviteCode": "..." }`. The code never appears in the URL or in logs.
- Proposed: **Logging policy.** One line per request from the pipeline: `requestId`, method, route pattern only (never the raw path), status, `durationMs` and error code. Thrown 500 and 503 errors are logged through a scrubbing logger:
  - an error that carries a string `code` logs only `{ name, code }` and no message;
  - other messages are scrubbed before truncating (`scheme://user:pass@` becomes `scheme://***@`, `Bearer` values and JWT-like strings are masked);
  - values under sensitive keys are redacted (matched on the normalized key name: token, auth, password, secret, cookie, invite code, user id, email, database URL, connection string, DSN, API key, jwt);
  - the Authorization header, bodies, notes, invite codes and environment values are never logged.
- Left OPEN, with the current behaviour kept: the stale-approval policy (Q13) and the 403-versus-404 policy for entries and circles (Q7 addendum, Q14).

### Spike results

Local spike S0.1 (2026-10-01; Supabase CLI 2.119.0, edge-runtime 1.77.1, Deno 2.1.4):

| Check | Result |
| --- | --- |
| Out-of-tree imports through a `deno.json` import map with relative paths to `packages/*/src/index.ts` | Work with no package restructuring and no `node_modules`; `.ts` extension imports are fine. `deno check` passes on a clean copy. |
| `import_map` in `config.toml` accepts `deno.json` | Yes (`[functions.api] import_map = "./functions/api/deno.json"`). |
| `verify_jwt = false` | Works; the function receives the request and verifies the token itself. |
| Real pathname prefix under `serve` | `/api`, so `basePath` is `/api`. A bare `/functions/v1/api` is a 404 from the router. |
| `SUPABASE_URL` inside the runtime against the token `iss` | They differ (`iss` is `http://127.0.0.1:54321/auth/v1`), so locally `API_JWT_ISSUER` MUST be set; without it every token is a 401 `wrongIssuer`. |
| Local signing keys | The CLI default is already ES256 and the JWKS is served; no key file is needed locally. |
| End to end | ES256 token: `POST /circles` gives 201 against local Postgres, a second one 409 `AlreadyInActiveCircle`. |
| CORS | The local Kong gateway adds `Access-Control-Allow-Origin: *`, so local runs do not prove the allow-list. |
| `deno.json` | Needs `"lock": false`, otherwise `deno check` writes a `deno.lock`. Versions are pinned in the map instead (see "Why no lockfile"). |
| Database URL from the container | `host.docker.internal:54322`. |

Not yet verified, because they need the hosted project (ops steps S0.2 and S0.3 below): out-of-tree import resolution on `functions deploy --use-api`, the bundle contents through `functions download`, the real prefix on the hosted gateway, the Supavisor transaction pooler under pool `max=3`, TLS and cold start. If the hosted bundle fails to resolve the imports, fall back to F1 or F2 above; only the shell and the import map change.

### Deploy-bundling risk (gate for C8)

`deno.json` maps `@pactjoy/*` to `../../../packages/*/src`, which is OUTSIDE `supabase/functions`. Only `functions serve` was spiked. It is unknown whether `supabase functions deploy` (with `--use-api` or with Docker) bundles files outside the function directory. Until S0.2 confirms it with a real deploy followed by `functions download` (checking that the `packages/*/src` files are in the bundle), the shell is not proven deployable and C8 must not count as done (DE-R4). If the files are missing, the fallback options, not yet chosen, are:

- a prebuild step that copies or bundles `packages/*/src` into `supabase/functions/_shared/` before deploy (F1);
- `deno bundle` into a single file inside the function directory, with a CI bundle step (F2).

Either way only the shell, the import map and the deploy procedure change; `packages/*` do not.

### Why no lockfile

`deno.json` sets `"lock": false`. The direct npm dependencies are exact-pinned in the import map (and a test checks them against `pnpm-lock.yaml`), and `postgres` and `jose` have no transitive dependencies. A `deno.lock` written by a newer Deno could break the older Deno in the Edge runtime. The cost is losing integrity hashes for those two packages.

### Config and gotchas

- `supabase/config.toml` is minimal and local-only: the Data API schemas (without `pactjoy`), Postgres 17, the email OTP shape (6 digits, 1 hour), `[functions.api]` and the placeholder OTP template. The repository does not push it to the hosted project (Q4). A boundary test pins the schemas, `verify_jwt = false`, the import map and the absence of service-role keys.
- The local signing key `supabase/signing_keys.json` is a secret and is gitignored. It is optional locally because the CLI default is already ES256.
- A function worker that cannot connect to the database dies and answers an empty 503 without CORS headers; a browser reports it as a network error. Check the function logs, not the response.
- The function reads secrets through `Deno.env`. Copy the pooler hostname into `API_DATABASE_URL` exactly as Supabase prints it. If the connection fails with an invalid-hostname error, check for an underscore in the host: some DNS and TLS stacks reject it. This is a precaution carried over from the task notes, not something the spike reproduced.

### Open questions

Product questions for the owner. None is decided here; each has a recommendation in the SDD decision notes.

1. Q1: Account deletion or anonymization in this change? (`DELETE /me` is reserved and not routed.)
2. Q2: Read-model queries for the PWA (get circle, get season, list habits)?
3. Q3: Member display names?
4. Q4: Adopt `supabase config push` for the hosted auth and API settings?
5. Q5: Which CORS origins are allowed (today an env allow-list; empty allows none)?
6. Q6: Open email OTP signup or invite-only?
7. Q7: Status-code semantics (the whole table is provisional).
8. Q8: Should an owner see their own private commitments in season responses?
9. Q9: Are pact approvals (who and when) visible to every member, or only a count plus "you approved"?
10. Q10: Does a member who left keep seeing the circle's member list?
11. Q11: Expose the invite's `createdBy`?
12. Q12: Should an empty or same-value season edit be a no-op instead of resetting approvals?
13. Q13: Should pact approval carry an `expectedVersion` so a stale approval is rejected (`StaleSeason` 409)?
14. Q14: Should a stranger on an existing entry id get 404 instead of 403 (existence disclosure; related to Q7)?
15. Q15: Does "private" hide only the habit and measure, or also `weightPercent` and `points` (which reveal the completion fraction)?

### Operational checklist (hosted Supabase, manual; the owner executes it)

Nothing here runs from CI or from the repository.

- S0.2: set up the hosted project and link it (`supabase link`). Follow the ADR-0010 checklist for `db push`; `pactjoy` must not be in the Data API exposed schemas.
- Auth: enable asymmetric JWT signing keys (the JWKS endpoint must serve ES256 or RS256), set the email OTP length to 6, put `{{ .Token }}` in the magic-link template, and configure SMTP through a provider API (port 465 or 2525; 25 and 587 are blocked).
- Secrets (`supabase secrets set`), never in a file in the repository:
  - `API_DATABASE_URL`: the Supavisor transaction pooler URL (port 6543) of a dedicated database role, never the service-role key;
  - `ALLOWED_ORIGINS`: comma-separated exact origins (for example the PWA origin); empty allows no browser origin;
  - `API_JWT_ISSUER`: optional; defaults to `${SUPABASE_URL}/auth/v1`, which is right on hosted.
- S0.2 (gate for C8, do this BEFORE treating the shell as done): `supabase functions deploy api --use-docker` first, then `--use-api`. Then `supabase functions download api` and check that the out-of-tree `packages/*/src` files, `postgres` and `jose` are in the bundle. Call the deployed function once to confirm the imports resolve at runtime. Record the result in the Spike results above; if the files are missing, choose between the fallbacks in "Deploy-bundling risk".
- S0.3: smoke test with a real OTP-login token: `POST /api/circles` returns 201, an invalid token returns 401 with the envelope, a browser preflight from an allowed origin returns 204. Check the pooler under concurrency and the cold start once.
- Add the `db` and `deno` CI checks to branch protection.
- If the deploy cannot resolve out-of-tree imports, apply fallback F1 or F2 (shell and import map only) and update this ADR.

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
