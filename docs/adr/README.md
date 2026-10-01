# Architecture Decision Records

An ADR captures one significant, hard-to-reverse technical decision: the
context that forced it, the decision itself, the alternatives that were
seriously considered, and the consequences of choosing it. It is a record of
_why_, not a design doc or a how-to.

## When to write one

Write an ADR when a decision:

- Would be expensive or disruptive to reverse later (stack, architecture,
  storage, module boundaries, cross-cutting conventions).
- Rules out at least one real alternative — if there was no other option
  worth naming, it probably doesn't need an ADR.
- Someone joining later would reasonably ask "why did we do it this way?"

Do not write an ADR for reversible implementation details, naming choices, or
anything already fully specified in Notion (see the root
[`CLAUDE.md`](../../CLAUDE.md)) — this repository does not duplicate product
decisions, only the technical ones made to build it.

## Naming convention

`NNNN-kebab-title.md`, e.g. `0002-monorepo-with-pnpm-workspaces-and-turborepo.md`.

- `NNNN` is a zero-padded, sequential, never-reused number.
- The title is short and kebab-case; it becomes the ADR's `<Title>`.

Start every new ADR from [`template.md`](template.md).

## Lifecycle

- **Proposed** — drafted, open for discussion.
- **Accepted** — decided; this is the current, binding decision.
- **Deprecated** — no longer relevant, but not replaced by a specific ADR.
- **Superseded by ADR-XXXX** — replaced by a later, linked ADR.

**ADRs are immutable once Accepted.** If a decision changes, do not edit the
old ADR's Decision or Consequences — write a new ADR, and set the old one's
status to `Superseded by ADR-XXXX`, linking to the new one. Small fixes
(typos, broken links) are fine to edit directly.

## Index

| #                                                           | Title                                                       | Status   | Date       |
| ----------------------------------------------------------- | ----------------------------------------------------------- | -------- | ---------- |
| [0001](0001-record-architecture-decisions.md)               | Record architecture decisions                               | Accepted | 2026-09-25 |
| [0002](0002-monorepo-with-pnpm-workspaces-and-turborepo.md) | Monorepo with pnpm workspaces and Turborepo                 | Accepted | 2026-09-25 |
| [0003](0003-use-biome-for-linting-and-formatting.md)        | Use Biome for linting and formatting                        | Accepted | 2026-09-26 |
| [0004](0004-scoring-engine-resolved-calendar-days.md)       | Scoring engine works on resolved calendar days              | Accepted | 2026-09-26 |
| [0005](0005-worked-examples-as-executable-spec.md)          | Worked examples are the engine's executable specification   | Accepted | 2026-09-26 |
| [0006](0006-bigint-fraction-arithmetic.md)                  | Exact rational arithmetic with hand-rolled BigInt fractions | Accepted | 2026-09-26 |
| [0007](0007-explicit-ts-import-extensions.md)                | Explicit `.ts` extensions on relative imports                | Accepted | 2026-09-28 |
| [0008](0008-use-case-and-port-conventions.md)                | Use-case and port conventions in `packages/app`               | Accepted | 2026-09-28 |
| [0009](0009-time-model-in-packages-app.md)                   | Time model in `packages/app`                                   | Accepted | 2026-09-28 |
| [0010](0010-postgres-adapter.md)                             | Postgres adapter: postgres.js, portable SQL migrations, non-exposed schema, NO KEY UPDATE guards, real-Postgres tests | Accepted | 2026-10-01 |
