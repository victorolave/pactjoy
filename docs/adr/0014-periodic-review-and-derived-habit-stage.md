# ADR-0014: Periodic review and derived habit stage

- **Status:** Proposed
- **Date:** 2026-10-12
- **Deciders:** Victor Olave

## Context

Design batch 4 adds the periodic review (Revisión periódica, screens 33 to 35c), the optional baseline automaticity survey (screen 13) and the habit maturity badge (screen 17). Until now `Review`, `automaticity` and `HabitStage` existed only as words in the glossary and in the engine docstring; nothing stored a review and nothing derived a stage.

Four forces shape the design:

- **Time-based status with no job.** A review becomes due when a period ends and lapses when the next one starts. There is no scheduler yet (ADR-0010, ADR-0011), and ADR-0013 already settled the same kind of question for pauses with lazy derivation.
- **Strict privacy.** A member's answers, reflection and stage are private (REQ-V*). Peers see points, consistency and ideal completion only (ADR-0011 addendum), never anything from the review.
- **Entries stay the source of truth.** The period summary and the stage must be recomputed from Entries, never stored, so an edited Entry cannot disagree with a stored figure (D12 in the scoring decisions).
- **Product numbers that are not calibrated.** The stage thresholds and the Spanish SRBAI wording have not been tested with real users.

## Decision

- **R1. The aggregate is one `ReviewRecord` per (season, member, period).** It has its own `version` and lives outside Season. The root stores `kind` (`baseline`, `interim`, `closing`), `status` (`completed`, `skipped`), `srbai` (`full`, `item1`, null), the two optional reflection texts and `recordedAt`. Children, one per Commitment, store the SRBAI items (`item1` required, `item2..4` optional). A unique key on `(season_id, member_id, period_index)` makes a submit idempotent: a second insert is `ConcurrencyConflict`, and the use case pre-checks it to answer `ReviewAlreadySubmitted`. A saved review is final in this change (no edit).
- **R2. Due and lapse are derived on read, never stored.** A pure `review-schedule.ts` derives the periods, the kind, the SRBAI mode and the due window from `lengthWeeks`, `reviewCadenceWeeks` and the season day. With `L` weeks and cadence `c` there are `P = ceil(L / c)` periods; the last one is shortened when `c` does not divide `L` and is the `closing` review. Interim review `k` is due from the first day after its period ends until the last day of the next period. The windows are disjoint, so at most one review is due at a time; a missed review is simply gone (no accumulation) and a read never writes. The closing review is due from the day after the season ends and never lapses, until `season-close-graduation` closes the season. The baseline is open from the pact approval through day 7 and is always the full survey.
- **R3. The mid-season full survey.** Interim reviews ask item 1 only, except the one nearest the middle of the season: `argmin_k |2kc - L|` over the interim periods, a tie going to the lowest `k`. It is pinned by a table test over every (`L`, `c`) pair. The baseline and the closing review are always full. Day indexing is 1-based in the spec and the schedule; the engine's 0-based `SeasonDay` is converted once, at the boundary.
- **R4. Per-commitment figures in the engine.** `commitmentWeeklySeries`, `periodFigures` and `poolPeriodFigures` are additive: they walk the same sessions as `weeklySeries`, so a property test proves that the commitments of a week sum to the member's week, that period points add up to the season points and that a whole-season range equals the engine totals. `weeklySeries`, `scoreMember` and the 96 acceptance rows are untouched. The period summary is recomputed on every read through the pause choke point (ADR-0013 D5); only answers are stored.
- **R5. `deriveHabitStage(input, HABIT_STAGE_THRESHOLDS)`.** A pure engine function with exact fractions. `graduated` if the flag is set; `integrated` when the trailing four counted final weeks are EACH at 80% or more (not pooled) and the latest automaticity is at least 5; `developing` when the last ended period with something counted is at 60% or more; otherwise `new`. Weeks with nothing counted (paused) are neutral, and a missing score caps the stage at `developing`. The stage is never stored, so it regresses when the last period falls under 60% or the automaticity drops (owner confirmed). The app passes `graduated = false` always, because no graduation path exists yet. All thresholds live in the single constant `HABIT_STAGE_THRESHOLDS`, so tuning them changes results with no migration.
- **R6. Privacy by construction, then verified twice.**
  - The port is `ReviewRepository { listMine(seasonId, memberId); save(record, expectedVersion | null) }`. It has no season-wide read, so a peer read cannot be expressed against it.
  - `review/review-guard.test.ts` copies the pause choke-point guard: only `src/review/` and the composition files may touch `repos.reviews`.
  - The four routes (`GET` and `POST /seasons/:seasonId/reviews/:periodIndex`, `POST .../skip`, `GET /seasons/:seasonId/commitments/:commitmentId/stage`) carry no member id; the actor is the token's user. Another member's commitment is `CommitmentNotFound` for the stage and `CommitmentNotOwned` when submitting.
  - `packages/api/test/review-privacy.test.ts` seeds sentinel reflections and answers, then scans every peer GET (season, progress, member and commitment progress, week summary, scores, standings, circle, pause approvals) for the sentinel strings and for review-like keys. Today carries `pendingReview` and `baselineOffer` for the viewer only.
- **R7. Baseline skip.** "Ahora no" stores `{periodIndex 0, status skipped}` with no answers, which stops the offer; it works across devices because the server is the authority. Only the baseline can be skipped (`ReviewNotSkippable`); repeating the skip, or answering after it, is `ReviewAlreadySubmitted`.
- **R8. Submit is validated, not locked.** It checks that the member is active, the window at `now`, the shape per mode and that every Commitment of the member is covered, paused ones included. A full review with any of items 2 to 4 missing is `AutomaticityIncomplete` (owner decision: the domain requires all four); an out-of-range score, an unexpected item in item-1 mode or a repeated Commitment is `InvalidAutomaticity`. Nothing is stored on rejection. There is no guard on the circle or the season: a review by a member who has since left is inert and private.
- **R9. Reflection text** reuses the entry note helpers (trim, empty becomes absent, same limit) and the errors `InvalidNote` and `NoteTooLong`, with a `field` of `helped` or `hard`.
- **R10. Improvements (35b).** The reference for a Commitment is the baseline if it answered it, otherwise its earliest earlier completed review. An improvement is judged on the tenths that are displayed (one decimal, half up), so a change that rounds to the same figure is not named. See "Known limitations" for the item-1 comparison.
- **R11. Wire surface.** Six new error kinds in the API status map (ADR-0011 Q21): `ReviewNotDue`, `ReviewAlreadySubmitted`, `ReviewNotSkippable` (409), `ReviewPeriodNotFound` (404), `InvalidAutomaticity`, `AutomaticityIncomplete` (422). The map now has 84 kinds.
- **R12. Deploy and rollback.** The migration is additive and forward-only (`reviews`, `automaticity_responses`, RLS on with no policies). Deploy order is migration, API, web; the previous web ignores `pendingReview` and `baselineOffer`. Rollback is reverting the merge and dropping `automaticity_responses` and then `reviews`; no Entry or score repair is needed.

## Alternatives considered

### A job that creates a pending review row per period

- **Pros:** a stored status is trivial to query.
- **Cons:** needs the hosted scheduler that does not exist, and a missed run silently loses reviews.
- **Why rejected:** lazy derivation is exact under a fixed clock and needs no infrastructure (the ADR-0013 approach).

### A stored habit stage

- **Pros:** cheap reads; a sticky "integrated".
- **Cons:** it would disagree with edited Entries, and thresholds could not change without a data migration.
- **Why rejected:** the stage is a function of Entries and reviews; deriving it keeps Entries the source of truth.

### A snapshot of the period summary inside the review

- **Pros:** the review screen would show exactly what the member saw.
- **Cons:** two sources of truth for the same figures; a late Entry would not be reflected.
- **Why rejected:** the summary is recomputed live (with a `final` flag while the last week is in its grace period); only answers are stored.

### Review JSON inside Season

- **Pros:** one aggregate fewer.
- **Cons:** every member's submit would contend on the Season version.
- **Why rejected:** one aggregate per (season, member, period) has no cross-member contention.

### A season-wide `listBySeason` on the port

- **Pros:** convenient for future social features.
- **Cons:** makes a peer read possible to write by mistake.
- **Why rejected:** the port exposes only the owner's rows (R6); a future need would be a new, explicit decision.

## Consequences

### Positive

- No new infrastructure: nothing is scheduled and a read never writes.
- A peer leak needs three independent mistakes (port, guard test and sentinel test) to ship.
- Thresholds and windows can change without a data migration.

### Negative

- A missed review is not recoverable and leaves no trace; this is the product rule, but it cannot be reported on later.
- Every stage read recomputes the member's weekly figures.

### Neutral

- The closing review is due from the day after the season ends, but the web hides it until `season-close-graduation`.

### Known limitations

- **REQ-A11, item-1 against full references.** When the baseline is a full survey and a later interim review asks only item 1, the two scores are compared as they are (item 1 against the mean of four). This is what the spec says; `comparableAutomaticity` is the single seam to change it if the data shows a bias.
- **Uncalibrated thresholds.** The 60% and 80% weekly thresholds, the four-week run and the automaticity of 5 are first estimates in `HABIT_STAGE_THRESHOLDS`.
- **Stage across seasons.** The stage is computed within one season. Concatenating the weeks of the same habit across seasons is deferred to `season-close-graduation`; the input is already a list of weeks so that this is a later pure addition.
- **Spanish SRBAI copy.** The four item phrases and the scale labels in the web have not been validated with the instrument's authors or with users.
- **Graduation.** `graduated` is never returned: there is no path to set it yet.

## References

- [ADR-0004](0004-scoring-engine-resolved-calendar-days.md), [ADR-0008](0008-use-case-and-port-conventions.md), [ADR-0010](0010-postgres-adapter.md), [ADR-0011](0011-api-layer.md) (Q21), [ADR-0013](0013-pause-lifecycle-and-lazy-settlement.md)
- Mechanics, "Revisión periódica" and "Automaticidad (SRBAI)" (Notion, private)
- Change `periodic-review` (specification, design and tasks)
