# ADR-0013: Pause lifecycle and lazy settlement

- **Status:** Proposed
- **Date:** 2026-10-12
- **Deciders:** Victor Olave

## Context

Until this change a Pause (Pausa) existed only as an engine concept. The engine already scored pending, approved and rejected requests (E7 to E23), but `packages/app` read them through a `PauseRequestReader` stub that returned nothing, so production scoring ignored every pause (ADR-0010, "Temporary stub"). Change A2 (`pause-workflow`) makes the Pause real: a member asks the circle, the circle answers, and after 48 h of silence the request is approved on its own (Mechanics, "Pausa (MVP)").

Three forces shape the design:

- **Time-based decisions with no job.** A pending request becomes approved at `requestedAt + 48 h`. The hosted Supabase project and a service-auth path for `pg_cron` do not exist yet (ADR-0010, ADR-0011), and a per-minute job could not keep the promise shown to the user ("viernes 16 a las 9:12").
- **One decision for many Commitments.** "Todos" asks for all of a member's Commitments in a single request with a single answer, while the engine models one request per Commitment (E21) and the early resume is per Commitment.
- **The gracePeriod.** A rejection or a cancellation extends the Entry window of the affected opportunities to the end of the day after the decision. It was a flat numeric offset hard-coded to 0 in the entry use cases, and an engine gap made a specificDays Entry accepted on that extra day but discarded by scoring.

## Decision

- **D1. The aggregate is the request.** `PauseRequestRecord` has its own `version` and lives outside Season. It is stored in three tables: `pause_requests` (the root: status, reason, note, dates, `auto_approve_at`, decision), `pause_request_commitments` (one row per Commitment, with its own `resumed_on` and `resumed_at`) and `pause_responses` (one row per approver). Routes use `:pauseRequestId`. Expansion to one engine `PauseRequest` per Commitment happens only in `toEnginePauses`.
- **D2. No `expectedVersion` on the answer.** `PUT /pause-requests/:pauseRequestId/response` takes only `{decision}`. A request's content is immutable after creation, so the only stale state that matters is "already decided" (`PauseAlreadyDecided` 409). Writes use `save(record, loadedVersion)` and a concurrent write surfaces as `ConcurrencyConflict` 409, which the web retries once.
- **D3. The effective decision is derived, never read from a column.** A pure `effectiveDecision` evaluates, in order: a stored final decision wins (Q3); no approvers means approved at `requestedAt` (Q1); every approver has answered means approved or rejected at the latest answer; `now >= autoApproveAt` means rejected if anyone rejected, otherwise approved at `autoApproveAt` (Q4); otherwise pending. `decidedOn` is the season-timezone day of `decidedAt`, so an automatic decision reports the day of the deadline and never the day of the read that noticed it. With three or more members a rejection therefore waits until everyone has answered or 48 h have passed; the owner confirmed this.
- **D4. Lazy settlement.** Reads never write. Every pause write first runs `settleSeasonPauses`, which persists each due pending request of the season in the same transaction. `settleDuePauses(deps, {})` is the idempotent, actor-less use case that change D will trigger from `pg_cron`; it has no route. If the surrounding use case fails, the settlement rolls back, which is harmless because the derived state is still correct.
- **D5. One choke point.** `loadEffectivePauses` (and `loadEffectiveRequests` for callers that need the request) is the only reader of `pauses.listBySeason` and `listDue` outside `src/pause/`. A guard test (`choke-point.test.ts`) fails if another file reads them, so no screen can show a stale "pending".
- **D6. Cancel and resume in the engine.** A cancelled request maps to `rejected{decidedOn = cancel day}` (Q2). Resuming an approved request writes `resumedOn = today` on the Commitment's own row and the request stays `approved`; if it had not started, the engine yields no paused, held or capped day at all, so it acts as a cancel. Resuming a pending request is `PauseNotPending`; it is cancelled instead.
- **D7. gracePeriod is a deadline.** `entryGraceDeadline(schedule, day, pauses)` in the engine is the single helper used by `planWeek` (fixing the specificDays branch), the history provenance, the app's entry window and Today. `PAUSE_GRACE_EXTENSION_DAYS` and the `pauseGraceExtensionDays` field are deleted.
- **D8. No pause lock in Entry transactions.** For a given opportunity the effective deadline never decreases over time (pending to rejected or cancelled extends it, approved changes nothing, decided is final). A stale read can only produce a false `WindowClosed`, and the retry succeeds. A property test pins this.
- **D9. Serialization of pause writes.** `requestPause` guards the circle and the season (`FOR NO KEY UPDATE`) before listing the requests, so two concurrent requests on one Commitment queue up and the overlap (Q5) and cap checks are race-free. Lock order is circle, then season, then the pause rows. See "Deviations" for what respond, cancel and resume do.
- **D10. Cap and budget.** The engine's `pauseBudget(season, history, today)` is the single source for the cap check and the budget read model. Any Commitment of the scope that fails blocks the whole request (Q11) with `PauseCapExceeded{commitments:[{commitmentId, reason, remainingDays}]}`. See "Deviations" for how planned days count.
- **D11. In-app notices are derived and stored nowhere.** Today rows carry a nested `pause`; the pending and approval cards come from `GET /me/pause-requests`, which also computes the "points redistributed" comparison for the latest approved request by scoring twice, with and without it.
- **D12. Leaving the circle.** `leaveCircle` during an active season cancels the leaver's pending requests (decided on the leave day) and re-decides the other pending requests with the reduced approver set at the leave instant. A leaver's approved pauses are untouched and do not alter anyone else's score.

## Deviations found while implementing

These were not in the design and are recorded here as decisions.

1. **`commitmentId` on resume is optional.** `POST /pause-requests/:pauseRequestId/resume` takes `{commitmentId?}`. Omitted means every Commitment of the request that is still running ("Todos", PL-33); a `commitmentId` that is not in the request is `CommitmentNotOwned`. The design had it required.
2. **Respond, cancel and resume guard the circle, not the pause row.** Taking the circle guard serializes all pause and Entry writes of that circle for one short transaction, and the record is re-read after the lock. Two approvers answering at the same time therefore both land instead of "one gets a 409". `ConcurrencyConflict` stays as the safety net and the web still retries once. Pause writes never bump the circle or season version.
3. **`redistributed` has a different shape.** It carries, per covered Commitment and for the season total, the exact points `before` and `after`, each rounded once. The design's `perOpportunity` is not included because the engine exposes no active-opportunity count. The copy of banner 30b for "Todos" stays generic and lists the Commitments.
4. **The cap counts planned days.** The engine counts a pending request only through today, so two non-overlapping future fixed-end requests together exceeded 50%. The cap and the budget now read a pending fixed span in full (`plannedBudgetHistory`, in the app); open requests keep counting through today, approved ones already counted their span and honor an early resume, and rejected or cancelled ones count nothing. The engine is unchanged.
5. **An Entry on an approved-paused opportunity is refused.** Creating or editing it is `OpportunityPaused` 409, distinct from `OpportunityOnHold` (pending). Deleting stays allowed, and from `resumedOn` (included) the opportunity is active again. Owner decision of 2026-10-12.
6. **API views are built by the app.** The use cases return the stored record. The names, icons and the private-Commitment rule need the season, the habits and the circle, so `pauseRequestViews` and `pauseApprovalViews` in `packages/app` read them and the API presenters only whitelist fields. A private Commitment reaches an approver as exactly `{kind: "hidden", commitmentId}`.
7. **Cache version.** The Today shape gained `pause` and scoring became pause-aware, so the web saved-Today `CACHE_VERSION` moved from "5" to "6" together with its pinned shape hash.

## Alternatives considered

### A cron job now

- **Pros:** the stored status is always current, so readers could trust the column.
- **Cons:** needs hosted Supabase, a service-auth path and an internal route that do not exist; per-minute granularity cannot keep an exact "9:12" promise.
- **Why rejected:** lazy derivation is exact to the millisecond and needs no infrastructure. The job still arrives with change D and only calls `settleDuePauses`.

### One row per Commitment with a `group_id`

- **Pros:** closest to the engine's shape.
- **Cons:** status and version are duplicated on sibling rows and can drift; "Todos" has no single decision.
- **Why rejected:** one root with children mirrors Season and keeps one status and one version per decision.

### The requests as JSON inside Season

- **Pros:** no new tables.
- **Cons:** pause writes would contend with `guardVersion` on the season and bump its version.
- **Why rejected:** a pause is not a pact change; it must not conflict with approvals or force clients to refetch the season.

### A Notifier port or an outbox for the in-app notices

- **Pros:** push-style delivery.
- **Cons:** there is no push in this change and ADR-0010 forbids side effects inside a unit of work.
- **Why rejected:** the notices are recomputed from Entries and requests on every read.

## Consequences

### Positive

- Production scoring and the Entry window now honor pauses, with no job and no new infrastructure.
- A decision is deterministic under `FixedClock` and exact to the millisecond.
- The gracePeriod has one definition shared by the engine, the entry window and Today.

### Negative

- Rows stay `pending` in the table until something settles them. Every reader MUST go through the choke point; the guard test enforces it for `packages/app`.
- Serializing pause writes per circle (D9, deviation 2) is coarser than a per-request lock. It is acceptable at one to six members per circle.
- Three tables and a forward-only migration to maintain; rollback means reverting the code and dropping the tables by hand, children first.

### Neutral

- Change D (scheduled jobs) only adds a trigger for `settleDuePauses`.
- Deploy order is migration, then API, then web; the previous web ignores the new fields.

## References

- [ADR-0004](0004-scoring-engine-resolved-calendar-days.md), [ADR-0008](0008-use-case-and-port-conventions.md), [ADR-0010](0010-postgres-adapter.md), [ADR-0011](0011-api-layer.md) (Q20)
- Mechanics, "Pausa (MVP)" (Notion, private)
- Change `pause-workflow` (specification, design and tasks)
