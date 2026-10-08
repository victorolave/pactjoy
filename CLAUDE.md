# CLAUDE.md

## Project

**PactJoy**: a social habits app. Personal (hobby) project; if it works it could become a product, but that decision is not being made yet.

Status (2026-10-08): MVP specification and design are complete; stack chosen (2026-09-24). Phase 1 done: `packages/engine` implements the full scoring engine and passes all 96 worked-example rows. Phase 2 (backend) done in code: `packages/app` use cases (`app-foundation`), Postgres adapter (ADR-0010) and the API (`packages/api` + the `api` Edge Function, ADR-0011), plus follow-ups (pact integrity, per-circle display names, viewer read models). Phase 3 in progress: `apps/web` PWA with Today and Entry (design batches 0–1, change `pwa-today-entry`, ADR-0012), onboarding, circle and profile (design batch 5, change `pwa-onboarding-circle-profile`), season, habits and pact (design batch 3, change `pwa-season-habits-pact`), and read-only season progress (design batch 2, change `pwa-season-progress`). Runs against local Supabase; hosted setup is pending (see Next steps). Verified tests: engine 444, app 997, api 607, db 336 (real local Postgres), web 1780; total 4164 passing.

The author works in Spanish: reply in Spanish. Code, commits and repository docs are in English.

## Source of truth

Product documentation lives in Notion (Home / Personal / labs / PactJoy), written in Spanish.

> **Note for readers of this repository:** the Notion pages and the design project are **private**; the links only work for the author. They are listed here because this file guides AI-assisted development. The public, executable version of the rules is the acceptance test suite in `packages/engine`.

Links:

- Root: https://app.notion.com/p/3e58ddfd78f881668959eb29835c3d31
- Product & vision: https://app.notion.com/p/3e58ddfd78f881bbaf71f2ebc6f17fb1
- MVP definition: https://app.notion.com/p/3e58ddfd78f8817a9e86cd6f0b86f52f
- Mechanics (habits, seasons, scoring, pause, SRBAI): https://app.notion.com/p/3e58ddfd78f88150bc40f2dd4c3cbc32
- Social experience & research: https://app.notion.com/p/3e58ddfd78f881d78f59d542dd41fe65
- Scoring engine, worked examples (acceptance tests): https://app.notion.com/p/3e58ddfd78f88170b3b7fd726a6d2f5a

MVP design (Claude Design, batches 0–5): https://claude.ai/design/p/239122e1-7217-4b6b-ac98-3383f1876fc6. If the design and Notion disagree, Notion wins.

Before proposing rule changes, read the Mechanics page. Do not duplicate business rules here: this file only points to Notion.

## Glossary (ubiquitous language)

One term per concept, used the same way in the rules, the code and conversations. Notion and the UI use the Spanish term; code uses the English one. Do not introduce synonyms (e.g. never `CheckIn` or `Log` for an entry).

| Spanish (Notion / UI)                             | English (code)                                                  | Meaning                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Hábito                                            | `Habit`                                                         | Long-term behavior; lives across seasons                                             |
| Compromiso                                        | `Commitment`                                                    | How a habit is worked during one season (frequency, minimum, ideal, weight, privacy) |
| Temporada                                         | `Season`                                                        | 4, 6, 8 or 12 weeks; weeks count from its start day                                  |
| Círculo                                           | `Circle`                                                        | 1–6 people sharing a season                                                          |
| Miembro                                           | `Member`                                                        | A person in a circle                                                                 |
| Pacto                                             | `Pact`                                                          | The set of commitments everyone approves before the season (unanimous)               |
| Oportunidad                                       | `Opportunity`                                                   | Unit of scoring: a session, a scheduled day or a week                                |
| Registro                                          | `Entry`                                                         | What a member logs for an opportunity                                                |
| "Hoy no salió"                                    | `missed` entry                                                  | Explicit "not done" for a day-bound opportunity                                      |
| Unidad                                            | `Unit`                                                          | done/not done, minutes, hours, times, pages, km, glasses, custom                     |
| Hecho / no hecho                                  | `done`                                                          | Boolean unit                                                                         |
| Dirección: alcanzar / no exceder                  | `Direction`: `reach` / `limit`                                  | More is better / less is better                                                      |
| Periodo: por sesión / semanal acumulado           | `Period`: `perSession` / `weeklyTotal`                          | Opportunity is a session / the whole week                                            |
| Frecuencia: N veces por semana / días específicos | `Frequency`: `timesPerWeek` / `specificDays`                    | How per-session opportunities are scheduled                                          |
| Mínimo                                            | `minimum`                                                       | Threshold for "reach"; counts for consistency                                        |
| Ideal                                             | `ideal`                                                         | Target that gives 100%                                                               |
| Tolerancia                                        | `tolerance`                                                     | Upper bound for "limit" (worth 50%)                                                  |
| Peso                                              | `weight`                                                        | Share of the member's 1,000 points                                                   |
| Progreso                                          | `progress`                                                      | Exact fraction 0–1 for one opportunity                                               |
| Puntos                                            | `points`                                                        | weight × 1,000 × average progress of active opportunities                            |
| Consistencia                                      | `consistency`                                                   | Share of opportunities that reached the minimum                                      |
| Cumplimiento ideal                                | `idealCompletion`                                               | Average progress (= points / potential)                                              |
| Racha                                             | `streak`                                                        | Consecutive opportunities (days or weeks) kept                                       |
| Pausa                                             | `Pause`                                                         | Freezes opportunities; neutral for scoring                                           |
| Prorrateo                                         | `proration`                                                     | Scaling N / minimum / ideal / tolerance by active days in a partial week             |
| Periodo de gracia                                 | `gracePeriod`                                                   | Until the end of the next day                                                        |
| Revisión periódica                                | `Review`                                                        | Private periodic review (≈60 s)                                                      |
| Automaticidad (SRBAI)                             | `automaticity`                                                  | Self-reported automaticity index, 1–7                                                |
| Graduación / graduar                              | `graduation` / `graduate`                                       | User decision to stop tracking a habit                                               |
| Estados 🌱🌿🌳🎓                                  | `HabitStage`: `new` / `developing` / `integrated` / `graduated` | Habit maturity                                                                       |
| Clasificación                                     | `standings`                                                     | Season ranking by points                                                             |
| Sugerencia de ánimo                               | `encouragementNudge`                                            | Voluntary suggestion to support a member                                             |
| Nombre visible                                   | `displayName`                                                   | A member's visible name within one circle (`Member.displayName`, per circle)         |
| Revisión del pacto                                | `pactRevision`                                                  | Counter that changes only when the pact content changes; unlike `season.version`, approvals do not bump it |
| Reacción                                          | `Reaction`                                                      | ❤️ 🙌 🔥 👏                                                                          |

## Repository (decided 2026-09-24)

- Public on GitHub: `victorolave/pactjoy`. It serves as both a portfolio and the product base.
- Code licensed under **AGPL-3.0**. The name, logo and visual identity are **not** under the AGPL (`TRADEMARKS.md`).
- No external contributions until the MVP; when they open, a CLA is required (to keep the dual-licensing option).
- Repository docs in English. Product notes stay private in Notion: do not copy their content into the repository without an explicit decision.
- Commits use the GitHub noreply email (configured in the local repo). Never commit secrets; never the Supabase service role key.
- Conventional commits, with no AI attribution or `Co-Authored-By` lines.
- The example names (Andrea, Victor) are fictional and can be used in tests and fixtures.

## Stack (decided 2026-09-24)

- **Client:** PWA with Vite + React + vite-plugin-pwa (SPA, no SSR). iPhone only in season 1. Native/Expo was ruled out because of the Apple Developer cost (99 USD/year); migrating later only replaces the client.
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions, pg_cron). Static hosting for the frontend.
- **API:** Supabase Edge Functions (Deno runtime), structured as if it were Nest: one module per use case, thin controllers, ports injected by hand. NestJS is ruled out for now: it needs an always-on server (~5 USD/month) or one that sleeps and breaks scheduled jobs. Edge Functions import the monorepo packages through a `deno.json` import map (ADR-0011). Still unverified: that `supabase functions deploy` bundles those out-of-tree imports (ops step S0.2).
- **Language:** TypeScript everywhere. Monorepo with pnpm workspaces.

### Guiding principle: high decoupling

Every piece of the system is replaceable. Each component (database, auth, hosting, API runtime, UI framework, notifications, storage, and tooling such as the linter or test runner) sits behind a boundary that the rest of the system depends on, never behind its concrete implementation. Swapping a piece should mean writing a new adapter, not changing the domain or the use cases.

In practice:

- Depend on ports (interfaces) owned by the inner layer; vendors live only in adapters.
- No vendor types, SDKs or conventions leak into `packages/engine` or `packages/app`.
- When adding a dependency, ask "what would it take to replace this?" If the answer touches the domain, redesign the boundary first.
- Replacing a significant piece is recorded as an ADR in `docs/adr/`.

### Architecture (hexagonal: Supabase is the facade, not the structure)

- `packages/engine`: pure domain (scoring, pause, proration, streaks). No dependencies. Exact fractions with BigInt, never `float`. Injected clock.
- `packages/app`: use cases; they depend on ports (repositories, clock, notifier, file storage).
- `packages/db`: Postgres adapter.
- `packages/api`: HTTP layer as framework-free handlers, router and presenters over the use cases (ADR-0011).
- `supabase/functions`: thin Deno shell (a single `api` function) that validates the JWT and delegates to `packages/api`.
- `apps/web`: the PWA (Vite + React, ADR-0012); talks to its own `api` interface and never writes to tables directly. Screens depend on ports (`PactJoyApi`, `AuthPort`); fetch, GoTrue, storage and TanStack Query live in `src/adapters`. The vendored design-system CSS (`src/design/vendor/`) and brand assets (`src/design/brand/`) are not covered by the AGPL (`TRADEMARKS.md`).

Rules so that a future migration (e.g. to NestJS) only replaces adapters:

- No business logic in Postgres (no triggers, no SQL functions, no RLS rules beyond "each member sees their own circle").
- Shared packages use only standard TypeScript/ESM: nothing Deno- or Node-specific.
- Every scheduled job is a use case; pg_cron only triggers it.
- No Supabase Realtime in the MVP.
- Entries are the source of truth; points are recomputed from them (this handles decision D12 with no special cases).

## Recently closed decisions (2026-09-24)

Full detail in the Mechanics page in Notion.

- Per-opportunity formula: the minimum acts as a threshold, then progress is proportional up to the ideal ("reach"); for "limit", 100% down to 50% between the ideal and the tolerance.
- Measurement model on three axes: unit × direction × period.
- Pause: auto-approved after 48 h without a response (the only exception to unanimity).
- Scoring engine specified: 12 decisions (D1–D12) closed and moved to Mechanics. Every row of the worked-examples page is an acceptance test.

## Next steps

1. ~~`packages/engine` + tests~~: done. Public API in `packages/engine/src/index.ts`; decisions in ADR-0004 to ADR-0006.
2. ~~`packages/app` use cases~~: done (change `app-foundation`, S0–S9 merged 2026-09-30). `packages/app` owns converting real time into `SeasonDay` (ADR-0004), the 48 h pause auto-approval and notifications.
3. ~~B: Postgres adapter and schema (`packages/db`)~~: done in code, with migrations in `supabase/migrations` and tests against real Postgres. Hosted setup is pending (ADR-0010 operational checklist): the decision is to stay on local Supabase for now and spike Neon before moving to the cloud.
4. ~~C: the API~~: done (change `api-edge-function-auth`, PRs #76–#108; ADR-0011 records decisions Q1–Q15), plus merged follow-ups: pact integrity, unique active circle, circle display names (`PATCH /circles/:circleId/members/me`) and viewer read models (`GET /me/today`, viewer-aware `GET /seasons/:seasonId` with `pactRevision`).
5. ~~PWA, Today and Entry (design batches 0–1)~~: done (change `pwa-today-entry`, PRs #141–#200; ADR-0012).
   - ~~Onboarding, circle and profile (design batch 5)~~: done (change `pwa-onboarding-circle-profile`, PRs #237–#257). Pending: real-device checks on iOS and Android (install step, notification permission, single login in the installed app) and rate limiting on `POST /circles/join/preview` before real users (ADR-0011 Q17 checklist).
   - ~~Season, habits and pact (design batch 3)~~: done (change `pwa-season-habits-pact`, PRs #259–#266 merged).
   - ~~Read-only season progress (design batch 2)~~: done (change `pwa-season-progress`, PRs #270–#290 plus the verification close-out; ADR-0011 addendum records the peer-privacy relaxation). Pending: real-iPhone checks of screens 23–25. Next: batch 4 (pause flows, reviews/SRBAI and photo evidence).
6. Later, in order:
   - A2: pause workflow; it must wire `pauseGraceExtensionDays`, currently hard-coded to 0 in the entry use cases. D: scheduled jobs (they trigger use cases).
   - A3: social.
   - E: account deletion.

Product question Q16 decided (2026-10-02): `timesPerWeek` sessions count until the week closes plus grace (weekly window, per Mechanics); the engine fix is merged (#140) and the web client sends `forDate` for the day the user saw.
