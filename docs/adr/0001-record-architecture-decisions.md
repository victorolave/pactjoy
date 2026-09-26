# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-09-25
- **Deciders:** Victor Olave

## Context

PactJoy already carries several closed technical decisions (repository
setup, license, stack) recorded only in `CLAUDE.md` as flat statements with
no rationale, alternatives, or consequences. As the codebase grows, future
decisions (monorepo tooling, how Supabase Edge Functions import workspace
packages, persistence choices, etc.) need a place to record _why_, not just
_what_, so the reasoning survives even if the decision is later revisited.

## Decision

Record architecture decisions as ADRs (Architecture Decision Records) under
`docs/adr/`, one file per decision, following the format and lifecycle
described in [`docs/adr/README.md`](README.md) and started from
[`docs/adr/template.md`](template.md).

`CLAUDE.md` keeps pointing to Notion for product decisions and continues to
list closed decisions as short entries, but from this point on, decisions
about the codebase's technical architecture get an ADR instead of (or in
addition to) a line in `CLAUDE.md`.

## Alternatives considered

### Keep using informal notes in `CLAUDE.md`

- **Pros:** Nothing new to learn or maintain; everything already lives there.
- **Cons:** No structured place for alternatives or consequences; decisions
  read as facts with no visible reasoning, which is exactly what makes them
  hard to revisit or challenge later.
- **Why rejected:** `CLAUDE.md` is meant to guide AI-assisted development, not
  to be the durable record of engineering reasoning. Mixing the two would
  make it grow without a clear shape.

### Record decisions only in Notion

- **Pros:** Single source of truth already exists there for product
  decisions.
- **Cons:** Notion is private (see `CLAUDE.md`); technical/architecture
  decisions about the open-source codebase should be visible to anyone
  reading the repository, including future contributors once the MVP opens
  up.
- **Why rejected:** Would hide engineering rationale from the public
  repository, which this project explicitly wants to serve as a portfolio.

## Consequences

### Positive

- Future technical decisions have a consistent place and format, reducing
  the effort to write one down.
- Alternatives and tradeoffs are preserved, not just the final choice.
- The public repository documents its own architecture reasoning.

### Negative

- One more artifact to keep updated; a decision recorded as an ADR but never
  revisited when circumstances change becomes misleading (mitigated by the
  supersede-don't-edit lifecycle rule).

### Neutral

- This ADR does not backfill records for decisions already closed before
  2026-09-25 (repository setup, license, stack choice) — those stay as-is in
  `CLAUDE.md`. Only new decisions from this point forward get an ADR.

## References

- [`docs/adr/README.md`](README.md)
- [`CLAUDE.md`](../../CLAUDE.md)
