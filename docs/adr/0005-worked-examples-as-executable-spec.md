# ADR-0005: Worked examples are the engine's executable specification

- **Status:** Accepted
- **Date:** 2026-09-26
- **Deciders:** Victor Olave

## Context

The rules (D1–D12) live in private Notion pages. The public repository
needs a verifiable version of them, and CONTRIBUTING requires engine
changes to be backed by acceptance tests.

## Decision

Every worked-example row is one acceptance test. Row tables live in
`packages/engine/src/acceptance/rows/`, one file per family. Each test name
starts with the row ID, and expected values are exact fractions written as
strings. A catalog test pins the set of row IDs (96 today). A rule change
starts by changing or adding a row (red), then the code (green). Tests
carry IDs, inputs and values, never Notion prose.

## Alternatives considered

### Free-form unit tests only

- **Pros:** Flexible, no table format to maintain.
- **Cons:** No traceability to the product rules and rows can be silently
  skipped.
- **Why rejected:** Loses the exact link between a Notion worked example and
  the test that proves it, which is the whole point of this ADR.

### Generate tests from a Notion export

- **Pros:** Single source of truth, no manual transcription.
- **Cons:** Couples CI to a private vendor and risks leaking private text
  into a public repository.
- **Why rejected:** The repository must stay public and independent of
  Notion availability; CONTRIBUTING already forbids copying Notion prose.

### Gherkin/BDD tooling

- **Pros:** Readable, human-facing scenario syntax.
- **Cons:** Adds a runtime and tooling dependency for no gain over plain
  data tables.
- **Why rejected:** `packages/engine` has zero runtime dependencies as a
  hard constraint; a BDD framework buys nothing that `test.for(rows)` over
  a plain array doesn't already give.

## Consequences

### Positive

- Rules are reviewable in public, and regressions point to a specific row
  ID.

### Negative

- Notion and the tables can drift; syncing them is a manual discipline.

### Neutral

- New families add a rows file and a catalog entry.

## References

- [ADR-0006](0006-bigint-fraction-arithmetic.md) — exact fractions used as
  the row expected-value format
- `sdd/scoring-engine/design` — Testing Strategy table
- `CLAUDE.md` — CONTRIBUTING test-first workflow
