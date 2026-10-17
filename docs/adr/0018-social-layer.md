# ADR-0018: Social layer: derived activity feed, reactions and encouragement nudges

- **Status:** Proposed
- **Date:** 2026-10-17
- **Deciders:** Victor Olave

## Context

The MVP's social experience (design batch 5 screens 31a, 31b and 32, plus the Today preview of batch 1 screen 15) adds three things to a circle: an activity feed, reactions to feed items and a voluntary encouragement nudge for a member who had a hard week. The Notion rules fix the product side: reactions are exactly ❤️ 🙌 🔥 👏 with no text, the nudge never mentions the hard week to its recipient, and the tone never emphasizes absence.

The owner decisions (2026-10-17) add: reactions target feed items; the "hard week" is a closed week with consistency below 50 % of the member's active opportunities; graduation appears in the feed; the feed shows the value of an entry on visible commitments only; one PR with work-unit commits.

The technical forces:

- **Entries are the source of truth** (CLAUDE.md, decision D12). A stored feed would need sync code for every edit, delete, pause and recalculation.
- **Privacy by construction.** Private commitments, notes, photos and quantities of private commitments must be unreachable from peer payloads, not merely filtered.
- **Hexagonal rules.** No business logic in Postgres, no Realtime in the MVP, the engine is not touched, and the push notification belongs to job D.
- **Account deletion (job E)** must be able to list every per-member column.

## Decision

### Derived feed

- **F1. Derived feed.** `deriveFeed(world): FeedRecord[]` is pure and lives in `packages/app/src/feed/`. The `circleFeed` query derives, sorts, pages and presents it for the viewer. Nothing about the feed is stored. Cost: one season load per read (at most 6 members and 12 weeks).
- **F2. Feed season.** The newest season of the viewer's active circle that has started (`actualStart` set and today in the season time zone on or after it), whatever its status. During the next season's `pactOpen` the feed keeps showing the closing season, including its close and graduation items. Reactions, the nudge and the encouragements are scoped to that same season.
- **F3. Stable keys,** 1-based numbers, ids only: `session:<commitmentId>:<day>`, `week:<commitmentId>:<week>`, `comeback:<memberId>:<day>`, `pause:<pauseRequestId>`, `recalc:<pauseRequestId>`, `graduation:<habitId>`, `season-start:<seasonId>`, `season-close:<seasonId>`, `encouragement:<id>`. Builders and `parseFeedItemKey` live in `feed/feed-key.ts`; the format is `^[a-z-]+(:[0-9a-f-]+|:\d+)+$`, at most 120 characters. The format is a compatibility contract: a change orphans reactions. An opportunity (not an entry) is the unit, so a delete-and-relog keeps its reactions.
- **F4. "Completó".** One item per `perSession` `(commitment, day)` whose live non-missed entries, summed (D4), give `progressAtValue > 0`; that covers `reach` above the minimum and `limit` within the tolerance. `at` is the latest `recordedAt` of those entries. `weeklyTotal` commitments produce no "completó". A `missed` entry never produces an item. A `timesPerWeek` surplus entry still yields "completó": the feed states what happened and does not score it.
- **F5. "Semana consistente".** A commitment's week that is `final`, with `counted >= 1` and `kept === counted` (from the engine's `commitmentWeeklySeries`). `onDate` is the date the week turned final (week end + grace + 1). Paused opportunities are already outside `counted`.
- **F6. "Volvió".** The first non-missed entry of the member on day D, where the previous day P with any live entry (a `missed` entry included: it is presence) leaves at least `COMEBACK_GAP_DAYS = 3` ACTIVE days strictly between P and D. A day is active when at least one of the member's commitments is not paused. It needs a prior P: the first entry of the season is not a comeback. No gap count is exposed. "Completó" and "volvió" are independent items and may both appear for the same day.
- **F7. Pause.** Only EFFECTIVE approved requests (`loadEffectiveRequests`, the choke point of ADR-0013), `at` is `decidedAt` (auto-approval included). Each gives `pause:<id>` (reactable) and `recalc:<id>` (a system item with no numbers). A request that covers 0 effective days produces no item. `subjects[]` are masked per subject; scope "all" lists every subject; the reason is shown unless every subject is private; the note is never shown.
- **F8. Graduation.** `Habit.graduatedAt != null` for a habit of a commitment of the feed season. The closure decisions are NOT read (`closure-guard` holds). A graduated habit is never carried into a later season, so this identifies the graduation season without a new column. `at` is `graduatedAt` and `onDate` its date in the season time zone. A private habit is masked as "un objetivo privado". **This reverses the copy promise of ADR-0015 (screen 38b, "Solo tú ves esta decisión")**; the owner decided it on 2026-10-17 and ADR-0015 gets a dated addendum. There are no hosted users, so nothing is exposed retroactively.
- **F9. Values.** A "completó" item on a VISIBLE commitment carries `{amount, unit}` (design 15 and 31a: "Correr · 5 km"); on a private one it is `null` (existence only). `done` commitments carry no value. Week counts ("7 de 7") appear only on visible commitments. Notes and photos never appear.
- **F10. Ordering and cursor.** The sort tuple is `(onDate desc, at desc with dateless items last, key desc)`. The cursor is opaque base64url JSON of the last tuple. The page size is fixed at 20. A bad cursor is `InvalidFeedCursor`. New items only appear at the top, so paging does not skip or repeat.
- **F11. Routes without a query string** (the router has none): `GET /me/feed` (first page plus the nudge) and `GET /me/feed/after/:cursor`.

### Reactions and encouragement

- **F12. Reactions.** `ReactionEmoji = "heart" | "raisedHands" | "fire" | "clap"` (codes; the glyph lives in the UI). One reaction per member per item, which can be changed or removed. `react` and `remove` derive the feed INSIDE `uow.transaction` (pure, safe to re-run) and require: the item exists for the viewer; it is a reactable kind (session, week, comeback, pause, graduation); the owner is not the reactor; the owner is still active; the reactor is active. Counts are per emoji plus `mine`; reactor identities are never returned. Orphaned keys are hidden on read and never deleted.
- **F13. Nudge.** A case is `(viewer, target, season, week)`. The target's POOLED figures for `week` are final, with `counted >= 1` and `2 * kept < counted` (exact integers). `week` must be the season's LATEST final week, so a case lives about 7 days. Exclusions: the viewer, members who left, circles with fewer than 2 active members, cases already dismissed or sent, targets the viewer already sent to today. At most one suggestion is shown, and none on a day the viewer already sent or dismissed one (the strict reading of "una por persona al día", owner default). Pick order: circle member order. The subject is the target's commitment with the most unkept opportunities that week (ties go to season order), or `{kind: "private"}`.
- **F14. Encouragement.** Sent only from a live suggestion. The database enforces UNIQUE `(season, sender, recipient, caseWeek)` AND `(sender, recipient, sentOn)`; `sentOn` is the season-time-zone date. Only the recipient sees `encouragementReceived` ("X te envió 🙌"); the sender does not see it in the feed.
- **F15. Dismissal.** `add` is idempotent (not a 409). `dismissNudge` accepts a live or already dismissed case; anything else is `NudgeNotAvailable`. "Shown" is not counted server-side: reads never write.
- **F16. Choke points.** `encouragement-guard.test.ts` confines `repos.encouragements` and `repos.nudgeDismissals` to `src/encouragement/`; their ports have NO season-wide read. `feed-guard.test.ts` forbids `src/feed/` from touching `reviews`, `seasonClosures`, `entryPhotos`, `.note` and `.photoId`. Reactions are not private, so they get no guard; the sentinel tests cover them (`feed-privacy.test.ts` in the app, a twin in the api).
- **F17. Push.** `encouragementNotice(repos, id)` in `src/encouragement/` is the hook for job D: whichever of A3 and D1 lands second adds the `encouragementNudge` outbox kind (`dedupeKey: "encouragement:<id>"`) inside `sendEncouragement`'s transaction. A3 owns no outbox. At the time of this change job D (`feat/scheduled-jobs-notifications`) had NOT merged into `develop`, so no push is wired here: the hook is `encouragementNotice` (it returns the recipient, the sender's display name and the emoji, and `null` once either side has left) plus this note. D adds the enqueue, the service-worker copy and the allowlist entry when it rebases.
- **F18. Web cache.** The feed is its own non-persisted query (`socialKey`), not part of `/me/today`, so `CACHE_VERSION` stays "9".

### Reconciliation with the earlier artifacts

The design wins over the spec where they differ, except where an owner decision says otherwise:

- keys follow F3 (the spec's `entry:<id>` is superseded);
- values follow the owner (F9, visible only);
- graduation is public (F8);
- reactions, the nudge and sends are scoped to the feed season (the spec's "active season" is superseded), so the close item and the final closer's graduation are reactable;
- the feed section is hidden for a one-member circle (the empty circle and the waiting room keep their screens);
- the comeback rule is exactly the owner's; the weekly noise for 1-2x/week schedules is a non-blocking note, with no behaviour change.

### Storage and coordination

- Three aggregates follow the Review and SeasonClosure pattern: `FeedReaction` `(seasonId, itemKey, memberId)`, `Encouragement` and `NudgeDismissal` (owner-only). No foreign key to members or commitments (their rows are delete-reinserted on save); a foreign key to `seasons` with RESTRICT, because these rows exist only for started seasons.
- Migration `20261018000000_social.sql`: RLS on with no policies, client roles revoked, no triggers or functions. The header comment lists the member columns for job E: `feed_reactions.member_id`, `encouragements.sender_member_id`, `encouragements.recipient_member_id`, `nudge_dismissals.viewer_member_id`, `nudge_dismissals.target_member_id`. For E: reactions are anonymized as "miembro que salió"; encouragements and dismissals are deleted.

## Alternatives considered

### A materialized `feed_items` table written by use cases

- **Pros:** cheap reads, a natural place for pagination.
- **Cons:** sync code for every edit, delete, pause and recalculation; a second source of truth.
- **Why rejected:** entries are the source of truth (D12); the read cost is bounded.

### Reactions on entries

- **Pros:** the unit is concrete.
- **Cons:** same-day entries add up (D4), and a delete-and-relog would lose the reactions.
- **Why rejected:** the opportunity is the real unit (F3).

### Chat, comments, "who reacted" lists, Realtime, per-period nudges

- **Why rejected:** the Notion rules reduce social pressure (counts only), Realtime is banned in the MVP, and a case that lives about one week keeps the nudge timely and never persistent.

### The feed inside `/me/today`

- **Pros:** one request.
- **Cons:** forces a `CACHE_VERSION` bump and refetches the heavy scoring on every reaction.
- **Why rejected:** F18, same precedent as the profile.

## Consequences

### Positive

- No sync code; scoring, standings and the engine are untouched.
- Privacy is structural: whitelisted records and presenters, ports without a season-wide read, guard and sentinel tests.

### Negative

- Every read costs a derivation, and `react` derives inside its transaction.
  - The derivation inside the reaction and send transaction costs a full feed derivation: 6 ms measured on a 2-member season with one entry, and it grows with the entries.
- The key format is a compatibility contract.
  - Item keys embed commitment and habit ids, so peers can link two masked private items of the same commitment. No content is exposed; accepted.
- Graduation becomes public: it supersedes the copy promise of ADR-0015 (addendum there).
- A member who left keeps her items.
  - They keep their habit names and values on visible commitments until account deletion (job E) anonymizes them.
  - Her display name is not sent: the feed member list carries `displayName: null` for `left: true`, and the web renders "Un miembro que salió".
- The hard week behind a nudge is pooled over ALL the target's commitments, private ones included, per owner rule #6048.2. Only the target id and the week reach the peer.
- Removing a reaction is idempotent under a race: a stale delete conflicts, and one retry in a fresh transaction re-reads the row and answers with what is there.

### Neutral

- Member habit summaries in the circle's member rows are a follow-up.
- Rate limiting stays pending (ADR-0011 Q17); the unique keys bound encouragement abuse and reactions are one row per item.

## References

- ADR-0008 (ports, addendum), ADR-0010 (Postgres adapter, addendum), ADR-0011 (API layer, addendum), ADR-0013 (pause choke point), ADR-0014, ADR-0015 (graduation, addendum), ADR-0016.
