# ADR-0015: Season closure, lazy finalization and habit graduation

- **Status:** Accepted
- **Date:** 2026-10-12
- **Deciders:** Victor Olave

## Context

Design batch 4 ends a season with the closing review, the results (screen 36), the decisions for the next season (37 to 38b) and, for the habits a member decides to stop tracking, graduation. Until now nothing moved a season from `active` to `closed`: a season whose last day had passed stayed `active`, which blocked `createSeason` and `joinCircle` for the circle for good (ADR-0013 and ADR-0014 both said "no job yet").

The forces:

- **No scheduler.** Job D is not built (ADR-0010, ADR-0011). ADR-0013 and ADR-0014 settled the same kind of question by deriving status on read and writing only inside transactions that already exist.
- **Strict privacy.** What a member decides about each commitment, and which habits they graduate, is private to them (REQ-V6, REQ-V7), as reviews are in ADR-0014. Peers keep seeing points and standings only.
- **Nobody may hold the circle hostage.** The next season should open when the circle is ready, but a member who never closes cannot block it forever.
- **A circle may have members who never had anything to close** (no commitments, or who left).
- **Entries are the source of truth.** A closure must never move points, standings or Entries.

## Decision

### Calendar

All days are 1-based and in the season's own time zone (`reviewDayOf` is reused). With `L` the season length in weeks:

| Day | Meaning |
| --- | --- |
| `1 .. L*7` | the season |
| `L*7 + 1` | grace day: entries are still accepted; the closing review is due from here (unchanged, ADR-0014) |
| `resultsFrom = L*7 + 2` | the results (36) and the closure open; the season may be finalized |
| `staleFrom = L*7 + 8` | seven full days after the last season day: the circle may open its next season without the members who have not closed |

| `L` | `resultsFrom` | `staleFrom` |
| --- | --- | --- |
| 4 | 30 | 36 |
| 6 | 44 | 50 |
| 8 | 58 | 64 |
| 12 | 86 | 92 |

### Decisions

- **C1. One `SeasonClosure` aggregate per (season, member).** It has `decisions` (one per own Commitment: `continue`, `adjust`, `pause` or `graduate`), `decidedAt` and `version` 0. A unique key on `(season_id, member_id)` makes it insert-once; a second insert is a `ConcurrencyConflict`, and the use case pre-checks it to answer `ClosureAlreadySubmitted`. A closure is final: no edit, no redo, and leaving the flow before the single POST stores nothing (the client holds the draft).
- **C2. The port is `SeasonClosureRepository { getMine, closedMemberIds, save }`.** Decisions have no season-wide read. The one season-wide read is `closedMemberIds`, member ids only (no decisions, no dates), which the finalization rule needs. This narrows the proposal's "no season-wide read" to "no season-wide read of decisions". `closure-guard.test.ts` confines `repos.seasonClosures` to `src/season/closure/`, asserts the exact method list and guards itself.
- **C3. Participants** are the circle's ACTIVE members who hold at least one Commitment of the season. A member who left, and a member with no commitments (nothing to close), count as done. With no participants the season is complete from `resultsFrom`.
- **C4. Results and closure open on `resultsFrom`, not on the grace day.** Screen 36 shows final numbers, and if everybody could close on the grace day nobody would be left to write `closed` (the late-entry window must stay open). Every completion therefore happens on or after `resultsFrom`, so the last closer can always finalize in its own transaction. The closing review is a precondition of closing and stays due from `L*7 + 1`.
- **C5. One pure rule decides finalization:** `moveOnState(season, participants, closedIds, day)` returns `complete` (results are open and every participant closed), `stale` (`day >= staleFrom`) or `blocked`. `finalizeSeason` is pure and idempotent. Who writes `closed`: `submitSeasonClosure` and `leaveCircle` only on `complete` (a leave that completes the set), `createSeason` and `joinCircle` on `complete` or `stale`. Readers derive `nextSeasonOpen` from the date alone and never write. Only the act of opening the next season cuts laggards off; a closure submitted after `staleFrom` does not finalize, so it does not cut off other laggards for nothing.
- **C6. Races.** `submitSeasonClosure` calls `seasons.guardVersion` FIRST (Postgres `FOR NO KEY UPDATE`, held to commit), then inserts, then reads `closedMemberIds`. That serializes two last closers: the second reads the first one's committed row and finalizes. The finalization saves with `expectedVersion = season.version`. A `createSeason` racing a closure: whichever commits first wins; the loser gets `ConcurrencyConflict` and then sees `SeasonNotActive` or the closed season. `packages/db/test/season-close-concurrency.pg.test.ts` runs both on real Postgres (and fails when the guard is removed: the two closers then each see the other as not closed).
- **C7. Graduation is `Habit.graduatedAt`.** It is written only inside the closure transaction, for the habits whose commitment decision is `graduate` (the habit must belong to the caller, else `CommitmentNotOwned`; an already graduated habit is left untouched). It is permanent: no un-graduate path, and `updateHabit` keeps it. `addCommitment` rejects a graduated habit (`HabitGraduated`, 409) and carry-over leaves it out. The stage stays derived: `deriveHabitStage` now receives `graduated = habit.graduatedAt !== null`. Graduation is allowed at any stage (screen 37 only highlights it when the stage is `integrated`); nothing graduates automatically.
- **C8. "Pausar" is only a decision value.** It never creates a Pause (ADR-0013); it is a default for the next pact.
- **C9. Carry-over is a read model of defaults.** `carryOver(seasonId)` (pact-open seasons only) reads the viewer's OWN closure of the circle's previous closed season and returns the previous measure, weight and privacy for `continue`, `adjust` and `pause` decisions. It creates nothing: the web offers "Seguir igual" as an explicit one-tap `addCommitment`, `adjust` opens the wizard prefilled, `pause` is a normal unchecked row. Weights and unanimous approval are unchanged.
- **C10. Today** carries `seasonClose { step, resultsFrom, nextSeasonFrom, nextSeasonOpen }`, `null` while the season runs. `step` is `closingReview` (the review card owns it, nothing extra), `resultsSoon`, `decide` or `waiting` ("Esperando a tu círculo": the viewer closed or has nothing to close). It is built from the viewer's own closure and the calendar only, so it says nothing about other members.
- **C11. History is limited to the viewer's current circle.** `seasonHistory` lists its closed seasons in which the viewer held a commitment (`closedByMe`, points, rank, member count). A cross-circle history would need a new `CircleRepository.listByUser` read and is out of scope.
- **C12. Helpers stay inside their choke points.** The review module exports `automaticityJourney` (the start: the baseline, else the earliest earlier completed review; the end: the closing review; compared like for like as in `improvementsOf`), `closingReviewDone` and `commitmentStages`; the closure module exports the lifecycle rule. Both guard tests stay green.
- **C13. Naming.** The use cases are `submitSeasonClosure`, `finalizeSeason` (pure) and `finalizeIfReady`. `pact/close-pact.ts` keeps its `closeSeason` (it closes the pact, not the season).

### Results (screen 36)

`seasonResults` is owner-only and recomputes everything from Entries on every call. It is readable from `resultsFrom` on, before and after finalization. The closing review is not a precondition of reading: `closingReviewDone` says whether it is done, and the automaticity end is absent until it is. This deviates from the raw spec (REQ-RS4 rejects the read), which the design superseded so that a closed season stays readable from Perfil for a member who was cut off before answering.

### Web behaviour

- **Closing review on the grace day.** The results open on `resultsFrom`, so a closing review finished on the grace day cannot lead to them. Its done step reads Today (`seasonClose.step === "resultsSoon"`) and shows "Tus resultados estarán listos el {fecha}." with a "Seguir con mi día" button to Today; otherwise the button is "Ver mis resultados" to `/season/:id/close`. The Temporada tab's review notice also shows the closing review (label "Revisión de cierre", no deadline).
- **Perfil.** The "Temporadas" section lists the closed seasons of `seasonHistory` as links to the read-only `/season/:id/results` (rank, points; a laggard row reads "Cerrada sin tus decisiones"). "Hábitos graduados" lists the viewer's graduated habits, newest first. "Consistencia histórica" and "Tus hábitos" keep their existing empty states.
- **ChooseHabits carry-over.** The group "De tu temporada anterior" offers "Seguir igual" (one-tap `addCommitment` with the previous measure, weight and privacy) and "Ajustar" (opens the wizard prefilled through router state). A habit the member left out ("Pausar") appears as a normal unchecked row with the hint "La dejaste fuera la temporada pasada" ("Pausa" is the ADR-0013 Pause, which the decision never creates, C8). Graduated habits are excluded, and a failed carry-over read is silent.
- **Deviations from the design copy.** Screen 38a says "Graduarlo significa dejar de registrarlo. Seguirá en tu perfil como hábito graduado. La decisión es definitiva.": graduation is permanent (C7), so the design's "podrás retomarlo en otra temporada" would contradict `HabitGraduated`. Screen 38b says "Solo tú ves esta decisión." instead of announcing it to the circle: graduation is private (REQ-V7) and there is no activity feed until A3.
- **Copy review.** The copy not taken from the design or the spec was derived and reviewed by the owner on 2026-10-12; the only change requested was the ChooseHabits hint above.

### Data

Two additive migrations: `season_closures` and `season_closure_decisions` (RLS on with no policies, no triggers, no functions), and `habits.graduated_at` (nullable, no backfill). Rollback drops them; seasons already `closed` stay valid.

## Alternatives considered

### A scheduled job that closes ended seasons

- **Pros:** the status is always true, and no reader needs the date rule.
- **Cons:** needs the hosted scheduler that does not exist; a missed run leaves seasons stuck.
- **Why rejected:** lazy derivation is exact under a fixed clock and needs no infrastructure (the ADR-0013 approach).

### Closing on the grace day

- **Pros:** one day sooner.
- **Cons:** the results are not final, and if every member closes on the grace day nobody is left to write `closed` without cutting the late-entry window.
- **Why rejected:** see C4.

### Closure decisions as JSON on Season

- **Pros:** one aggregate fewer.
- **Cons:** every closure would contend on the Season version, and peers would receive the decisions with the season.
- **Why rejected:** one aggregate per (season, member) has no cross-member contention and keeps decisions behind an owner-only port.

### Any member can close the season explicitly

- **Pros:** simple to explain.
- **Cons:** one member cuts the others off at will.
- **Why rejected:** the circle moves on when everybody is done or a week has passed.

### Deriving graduation from closure rows

- **Pros:** no new column.
- **Cons:** every read of a habit, ChooseHabits, Perfil and the stage badge would join through commitments and closures.
- **Why rejected:** one nullable column is simpler and keeps those reads cheap.

### Auto-created commitments from the decisions

- **Pros:** fewer taps.
- **Cons:** skips the pact: weights and unanimous approval would be decided for the member.
- **Why rejected:** owner decision; carry-over only offers defaults.

## Consequences

### Positive

- No new infrastructure: nothing is scheduled and a read never writes.
- A circle can always move on: when everybody closed, or a week after the season ended.
- A peer leak of a decision or a graduation needs three independent mistakes (port, guard test and the sentinel test in `season-close-privacy.test.ts`) to ship.

### Negative

- Laggards are cut off only when the next season is opened, so a season can sit `active` after everyone but one closed.
- `closedMemberIds` is a season-wide (existence-only) read in an otherwise owner-only module.
- Carry-over and history are limited to the same circle.

### Neutral

- The closing review is now surfaced and completable in the web (ADR-0014 hid it).
- The stale day is a date rule, so it needs no data; changing it is a one-line change in `season-calendar.ts`.

### Known limitations

- **Stage thresholds are still uncalibrated** (ADR-0014): graduation does not depend on them, but the highlight on screen 37 does.
- **The stale threshold** is `L*7 + 8` (seven full days after the last season day); the owner has still to confirm it against `L*7 + 7`.
- **Pre-existing gap.** `addCommitment` does not check that the habit belongs to the caller; this change only adds the graduated check.

## Addendum: graduation is announced in the circle feed (2026-10-17, change `social-reactions`, ADR-0018)

A graduation is no longer private. The circle feed derives a "graduó" item from the season's own graduate decisions, read through a closure-module helper (`seasonGraduations`) that exposes graduate decisions only (revised 2026-10-17 after review: `Habit.graduatedAt` cannot say which circle's close graduated a habit reused across circles; the port and `closure-guard` are unchanged), and peers read "{Nombre} graduó {hábito}" in "Actividad del círculo". This supersedes two statements above:

- **REQ-V7 and "Strict privacy"** (Context): what a member decides about each commitment stays private, and so does the `leave`, `adjust` and `pause` choice; only the graduation, the outcome the design always meant to celebrate, is announced.
- **The screen 38b deviation** (Web behaviour): "Solo tú ves esta decisión." and "there is no activity feed until A3" no longer hold. Screen 38b now says what the circle will read, as the design does: "Andrea verá “Victor graduó Leer” en la actividad del círculo." (several peers are named with commas and "y"; "Tu círculo" when no name is known).

Private habits are masked: the feed and the 38b line say "un objetivo privado" ("Tu círculo verá que graduaste un objetivo privado."), never the name. `SC-G4` still covers every route that existed before A3; the new `GET /me/feed` has its own privacy test (`social-privacy.test.ts`). Nothing is exposed retroactively: there are no hosted users.

## References

- [ADR-0008](0008-use-case-and-port-conventions.md), [ADR-0010](0010-postgres-adapter.md), [ADR-0011](0011-api-layer.md) (Q22), [ADR-0013](0013-pause-lifecycle-and-lazy-settlement.md), [ADR-0014](0014-periodic-review-and-derived-habit-stage.md)
- Mechanics, season close and graduation (Notion, private)
- Change `season-close-graduation` (proposal, specification, design and tasks)
