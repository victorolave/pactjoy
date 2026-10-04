# ADR-0012: Web client architecture: `apps/web` as a hexagonal SPA

- **Status:** Proposed
- **Date:** 2026-10-02
- **Deciders:** Victor Olave

## Context

The backend is done (ADR-0008 to ADR-0011) and the next step is the PWA (CLAUDE.md, Stack). The client must follow the same high-decoupling rule as the rest of the system: every vendor (HTTP, auth provider, storage, server-state cache, icon set) sits behind a boundary and can be replaced by writing an adapter. The toolchain also has one unusual fact: `typescript@7` is the native compiler and exposes no classic JavaScript API, so any tool that loads the TypeScript API cannot run. Vite 8 and Vitest 5 only transpile (oxc) and are unaffected.

The first change (`pwa-today-entry`) covers the foundation, login, the Today screen and entry registration. Product decisions that are still open are recorded as provisional in the table at the end.

## Decision

- **Hexagonal client.** `apps/web` is a Vite + React SPA organised by feature (`auth`, `today`, `entry`, `offline`). Screens depend on ports (`PactJoyApi`, `AuthPort`, `TokenStore`, `Clock`, `IdSource`, `Connectivity`) injected through React context. Adapters (`fetch`, GoTrue REST, `localStorage`, the query persister) live in `src/adapters` and `src/main.tsx` only. Biome (`noRestrictedGlobals`, `noRestrictedImports`) and guard tests enforce it.
- **Type-only coupling to the backend.** The only link to the monorepo is `import type` from the `@pactjoy/app` root (`TodayView` and the error kinds). It is erased at build time, so the client never bundles server code. Importing `@pactjoy/api`, `@pactjoy/db` or `@pactjoy/engine` is forbidden. The client never computes points: the server is the source of truth (CLAUDE.md, entries are the truth).
- **Server state with TanStack Query, confined.** TanStack is allowed only in `src/composition`, `src/shell/ErrorBoundary.tsx`, `src/features/*/queries.ts` and the persister adapter. After every mutation the client invalidates `["today"]`. There is no optimistic scoring.
- **Auth through GoTrue REST, no SDK.** Four `fetch` calls (`/auth/v1/otp`, `/verify`, `/token?grant_type=refresh_token`, `/logout`) behind `AuthPort`, with the anon or publishable key only (never the service role key). `supabase-js` is rejected as a vendor SDK inside the client.
- **Tokens in `localStorage`** behind `TokenStore`, with a cross-tab `storage` subscription (refresh tokens rotate). Risk: XSS can read them. Mitigations: no `dangerouslySetInnerHTML`, a CSP later. Moving to another store is a new adapter.
- **Errors.** Adapters throw `ApiError` (TanStack's contract). One exhaustive `toUiError` table, checked at compile time with `satisfies Record<KnownCode, UiKind>`, maps every API code to a UI behaviour.
- **Design system CSS vendored verbatim** with a provenance header and a sha256 manifest. The test that verifies the hashes lands with the CSS itself (not yet in the repository). Whether the tokens and `components.css` count as brand identity under `TRADEMARKS.md` is an open owner decision (P9); until then the slices that vendor them stay on local branches.
- **Biome only.** No oxlint or ESLint: the adherence rules are ported as Biome rules plus guard tests. Biome 2.5 has no type-only import option, so `apps/web/test/boundary.test.ts` enforces `import type ... from "@pactjoy/app"` for every `@pactjoy/*` import and re-export (dynamic imports included), keeps `globalThis.fetch` and `window.localStorage` inside `src/adapters`, and keeps `import.meta.env` inside `src/config.ts`.
- **TypeScript 7 constraint.** No tool that loads the TypeScript JS API: vite-plugin-checker, vite-plugin-dts, typescript-eslint, ts-node, react-docgen-typescript and Vitest `typecheck` mode are banned. Type checking is `tsc --noEmit`.
- **Offline is read-only.** The last successful Today is persisted (only `["today"]`, 24 h) and shown with a banner. Writes are disabled while offline and there is no write queue (P1).

## Alternatives considered

### `supabase-js` in the client

- **Pros:** less code, session handling built in.
- **Cons:** a vendor SDK in the client, larger bundle, its session model leaks into screens.
- **Why rejected:** the guiding principle; four REST calls behind a port are cheap.

### Tailwind or vanilla-extract

- **Pros:** utility ergonomics, typed styles.
- **Cons:** a second token source next to the design system's CSS variables.
- **Why rejected:** the design system already ships CSS custom properties; CSS Modules plus `var(--...)` keep a single source.

### MSW or Playwright now

- **Pros:** closer to real network behaviour.
- **Cons:** more tooling and setup for a first slice; the port already gives a seam.
- **Why rejected:** Vitest with a fake `PactJoyApi` and a stub `fetch` for adapters is enough for this change. Revisit when there are several screens.

### Engine on the client

- **Pros:** instant points preview.
- **Cons:** two implementations of the rules, drift risk, BigInt fractions in the bundle.
- **Why rejected:** the server recomputes from entries; the client shows server-confirmed progress only.

## Consequences

### Positive

- A native or React Native client reuses the ports and replaces only adapters.
- The backend contract is checked by the compiler through type-only imports, with no codegen.
- Every vendor has one file or folder to replace.

### Negative

- Hand-written GoTrue calls must follow the provider's error codes.
- Tokens in `localStorage` are exposed to XSS.
- No offline writes: a user without a connection cannot register.

### Neutral

- Guard tests complement Biome where Biome has no rule.

## Provisional decisions

Recorded while the owner is unavailable; to be confirmed.

| ID | Provisional choice |
| -- | ------------------ |
| P1 | Offline read only, no write queue |
| P2 | Additive API fields (`pendingYesterday`, `category`, `recordedAt`, weekly count, week close date) deferred; their visuals are hidden |
| P3 | No per-entry points in the UI; server-confirmed progress only |
| P4 | No dark mode |
| P5 | Brand imagery and logo not committed; neutral placeholders |
| P6 | Four tabs; Temporada, Círculo and Perfil are stub routes |
| P7 | Dev seed through the API against local Supabase only |
| P8 | Placeholder Spanish copy for error toasts |
| P9 | Design-system CSS is not published until the owner decides on the brand question |

## References

- ADR-0003 (Biome), ADR-0008 (ports), ADR-0011 (API layer)
- `TRADEMARKS.md`
