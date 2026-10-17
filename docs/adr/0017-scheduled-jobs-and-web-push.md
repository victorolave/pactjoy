# ADR-0017: Scheduled jobs and Web Push: transactional outbox, job routes, hand-rolled Web Push

- **Status:** Proposed
- **Date:** 2026-10-17
- **Deciders:** Victor Olave

## Context

Until this change no job ran and no push was ever sent. `settleDuePauses` (ADR-0013) and the global `sweepEntryPhotos` (ADR-0016) had no trigger, and onboarding asked for a notification permission that nothing used (ADR-0012). Notion lists push notices as part of the MVP: the pact waiting for approval, pause requests and decisions, the day before a pause ends, the periodic review, the season's start and close, and per-commitment reminders (D2, a later change).

The forces:

- **Forbidden notices.** Notion forbids pushes about being overtaken, losing, position changes, a lost streak or not having logged. "Competition motivates inside the app; it does not chase the user outside it."
- **No side effects inside a transaction.** ADR-0010: `work` may run twice (a failed COMMIT re-runs it), so it must never call the network.
- **Everything lazy keeps working.** Pause settlement, review due status and season finalization are derived on read (ADR-0013 to ADR-0015). If the trigger stops, the app must still work; it just goes quiet.
- **Replaceable pieces.** No push vendor or scheduler may reach `packages/app` (CLAUDE.md, high decoupling). There is no hosted environment yet, so the trigger must be an adapter detail.
- **iOS.** Web Push works only in an installed PWA (iOS 16.4+), after a permission granted from a user gesture, and every push must show a notification.
- **Owner decisions (2026-10-17).** Two PRs: D1 (infrastructure and system notices) and D2 (reminders). Calendar notices go out at 09:00 season-local; quiet hours are 22:00 to 08:00. `pauseApproved` also reaches the requester after the 48 h auto-approval. Pact pending: at most one push per recipient and day. Milestones and the weekly summary stay in-app.

## Decision

### Outbox and kinds

- **J1. Transactional outbox.** A use case that announces something adds plain rows to `notification_outbox` in its own transaction through `enqueueNotices(repos, drafts, now)`. The rows commit or roll back with the change. Nothing leaves the process inside `work`.
- **J2. Closed kinds.** `NotificationKind` is `keyof NotificationParams`: `pauseRequested`, `pauseApproved`, `pauseRejected`, `pauseEndsTomorrow`, `pactPendingApproval`, `seasonStarted`, `reviewDue`, `seasonClosed`. `KIND_POLICY` gives each one its timing (`immediate` or `morning`) and whether it rolls over. An allowlist test pins the list and scans names for forbidden words; the database CHECK repeats it. Adding a kind is a deliberate edit in the test, the policy, a migration and the service-worker copy.
- **J3. Choke point.** `repos.notifications` and `repos.pushSubscriptions` are used only inside `src/notifications/` (`notification-guard.test.ts`). Pause and review facts are read through their own modules' helpers (`pause-notices.ts`, `review-notices.ts`), never their repositories.
- **J4. Ids only.** Outbox params and the push payload `{v: 1, kind, params}` carry ids and dates only: never a name, a note, a value, points or a position. The service worker turns them into Spanish copy and a destination. A deleted member or a private commitment therefore leaks nothing.
- **J5. The dedupe key is the primary key.** `INSERT ... ON CONFLICT DO NOTHING` makes every enqueue site and every job re-runnable. Keys: `pauseRequested:{request}:{member}`, `pauseDecided:{request}` (approved or rejected, announced once), `pactPending:{season}:{member}:{localDate}`, and `{kind}:{season}[:{subject}]:{member}` for calendar notices.

### Who is notified, and when

| Kind | Recipient | Enqueued by | Timing | Dropped at dispatch when |
|---|---|---|---|---|
| `pauseRequested` | each approver | `requestPause`, when the request stays pending | immediate, until `autoApproveAt` | the request is no longer pending |
| `pauseApproved` / `pauseRejected` | the requester | the write that persists pending -> decided: `respondToPause`, `settleSeasonPauses` (48 h job and lazy settle-first), `settlePausesOnLeave` | immediate, 24 h | never |
| `pauseEndsTomorrow` | the pauser | planner | 09:00-22:00, no rollover | no longer approved and ending tomorrow |
| `pactPendingApproval` | members without an approval | `approvePact`, when the pact stays open | immediate, 24 h | the pact closed or the member approved |
| `seasonStarted` | participants | planner, start day | 09:00-22:00, one rollover | the season is not active |
| `reviewDue` | participants whose review is due | planner, first day of an interim review | 09:00-22:00, one rollover | the review is no longer due |
| `seasonClosed` | participants | planner, results day (absorbs the closing review) | 09:00-22:00, one rollover | never |

- A single reject in a circle of three decides nothing, so it notifies nothing; only a persisted transition does.
- `pactPendingApproval` fires on approval, not on every edit: there is no "propose" step, an edit resets approvals, and the editor's re-approval is what asks the others.
- `pauseEndsTomorrow` uses Today's own "ends tomorrow" rule (`todayPauseOf`), for a fixed end or an open pause reaching the 50% cap.
- Participants are the active members holding a commitment of the season (`participantsOf`). Every notice also checks, at dispatch, that the recipient is still that active member.
- "Local" is the season timezone (there is no per-member one). `TimeZone` gains `localTimeAt` and `instantAt` (ADR-0009 addendum).

### Jobs

- **J6. Planner.** `planNotifications` derives the calendar notices from state and the clock. It plans a season only while `now` is inside its 09:00-22:00 window, for today, and for yesterday's events of kinds that roll over (a day the planner never ran). It keeps no state: the dedupe key is the memory. One transaction per season. `SeasonRepository.listForPlanning(date)` returns active seasons and closed ones started since `date` (90 days back).
- **J7. Dispatcher.** `dispatchNotifications` claims up to 50 due rows (`pending` and due, or `sending` with an expired lease) with one `UPDATE ... RETURNING` over a `FOR UPDATE SKIP LOCKED` selection, setting a 5-minute lease and one more attempt. The claim commits first. Then, per row: past its window, a morning notice with a rollover left moves to the next day's window, anything else ends `dropped:expired`; inside quiet hours it goes back to `pending` until 08:00 (the attempt is given back); not relevant or recipient left ends `dropped`; no device ends `dropped:noSubscription` (a later device never replays it). Otherwise it is sent to every device the sender accepts, outside any transaction. Any delivery is `sent`; a 404/410 deletes that device; a temporary failure on every device retries after 1, 5, 15 and 60 minutes (or `Retry-After`), up to 5 claims, then `failed:exhausted`; a refusal on every device is `failed:rejected`. `finish` and `reschedule` are fenced by state and attempt count, so a dispatcher whose lease expired cannot overwrite a newer claim. Final rows are purged after 7 days.
- **J8. Job routes.** A second pipeline under `/api/jobs`: `POST /settle-due-pauses`, `/sweep-entry-photos` (limit 100), `/plan-notifications`, `/dispatch-notifications`. It is mounted only when `API_JOBS_SECRET` (32+ characters) is set; otherwise every job path is 404. `Authorization: Bearer <secret>` is compared in constant time (SHA-256 both, then a full XOR). No CORS. Answers are counts only. The pipelines have different caller types, so a user token never opens a job route and the secret never opens a user route. Never the service-role key.
- **J9. Trigger.** Locally, `pnpm jobs:tick [--watch 60]` POSTs the four jobs in order (settle, sweep, plan, dispatch), reading `JOBS_BASE_URL` and `API_JOBS_SECRET` from the environment. Hosted, pg_cron + pg_net (secret in Vault) or a scheduled CI job call the same routes; neither is committed as a migration. A 15-minute tick is enough: immediate notices arrive within one tick.

### Devices and Web Push

- **J10. Subscriptions.** `push_subscriptions` is user-level, unique by endpoint: the same browser signing in as someone else moves to them. At most 10 devices per user. `PUT /me/push-subscription` registers the caller's device; `POST /me/push-subscription/remove` drops it (the pipeline refuses DELETE bodies, and the client knows the endpoint, not an id). `GET /me/push-config` serves the public VAPID key, so a key rotation needs no web rebuild.
- **J11. SSRF guard.** The endpoint is user input the server POSTs to. `PushSender.accepts` allows https only, no port, no userinfo, on `*.push.apple.com`, `fcm.googleapis.com`, `updates.push.services.mozilla.com` and `*.notify.windows.com`. It is checked on save and again before every send; the host list lives in the adapter.
- **J12. `packages/push`.** A new adapter package, standard TypeScript/ESM on WebCrypto only (Node and Deno): RFC 8291 encryption in the RFC 8188 `aes128gcm` coding (one record, verified byte for byte against RFC 8291 Appendix A) and RFC 8292 VAPID with ES256. It sends `TTL`, `Urgency`, `Topic` (a hash of the dedupe key, so duplicates collapse in the push service) and maps statuses to delivered, gone (404, 410), retry (429, 5xx, network) and rejected. VAPID keys are `API_PUSH_VAPID_PUBLIC_KEY` (base64url point, 87 characters), `API_PUSH_VAPID_PRIVATE_KEY` (base64url scalar, 43) and `API_PUSH_VAPID_SUBJECT` (`mailto:` or `https:`), all three or none; without them dispatch sends nothing and devices cannot subscribe. `pnpm --filter @pactjoy/push generate-vapid-keys` prints a pair.
- **J13. Web.** The PWA moves to vite-plugin-pwa's `injectManifest` with a hand-written service worker that keeps the precache, the navigation fallback and its denylist, and adds `push` (always shows a notification) and `notificationclick` (focus or open a same-origin path). Subscribing sits behind a `PushSubscriptionPort`; the app re-syncs on start when permission is granted, and signing out removes the device before the session is cleared (ADR-0012 addendum).

### Erasure (change E)

Account deletion must delete `push_subscriptions` by `user_id` and `notification_outbox` rows by `recipient_user_id` or `recipient_member_id`. Pending notices about an erased member drop at dispatch because their pause or season is gone or no longer relevant.

## Alternatives considered

### Send from the use cases (a `Notifier` port)

- **Pros:** No table; immediate.
- **Cons:** A network call inside `work`, which may run twice (ADR-0010); a rolled-back change could still notify.
- **Why rejected:** The outbox gives the same result transactionally, and retries come for free.

### npm `web-push`, a small WebCrypto library, or a push vendor (OneSignal, FCM)

- **Pros:** Less code to own.
- **Cons:** `web-push` is Node-centric (unverified on Deno); small libraries add maintainer risk; vendors lock in the device registry and see the payload.
- **Why rejected:** About 300 lines on WebCrypto, verified against the RFC vectors, keep the adapter replaceable and dependency-free, as with SigV4 (ADR-0016).

### pg_cron as a migration

- **Pros:** The trigger lives with the database.
- **Cons:** There is no hosted environment to verify it, the secret would have to be committed, and it ties the trigger to Supabase.
- **Why rejected:** The trigger stays an adapter detail; the ops checklist documents the SQL to run by hand.

### Server-rendered copy and URLs in the payload

- **Pros:** The service worker stays trivial.
- **Cons:** Spanish copy and routes belong to the web client (CLAUDE.md); names in the payload would need per-recipient privacy rules on the server.
- **Why rejected:** Ids-only payloads keep privacy uniform and let the copy evolve with the client.

### A route flag on the user pipeline for job auth

- **Pros:** One pipeline.
- **Cons:** User routes would need an `Actor | JobCaller` union, and a mistake could open a job route to a browser.
- **Why rejected:** Separate pipelines keep each caller type exact and the jobs path invisible when unconfigured.

## Consequences

### Positive

- The trigger and the push service can each be replaced by writing one adapter; jobs are idempotent, so any cadence or duplicate run is safe.
- No forbidden notice can be expressed without a deliberate, reviewed edit.
- If the trigger stops, the app keeps working; only pushes stop.

### Negative

- Delivery is late by up to one tick; a 15-minute tick makes immediate notices up to 15 minutes late.
- The planner scans every live season on each tick (bounded by the 90-day window).
- The crypto is hand-rolled; iOS delivery can only be checked on a real device over https.
- The derived Spanish copy needs the owner's approval at the real-iPhone check.

### Neutral

- Outbox rows are kept 7 days after they end, for diagnosis, then purged by the dispatcher.

## Ops checklist (owner)

1. Generate the VAPID pair; set `API_PUSH_VAPID_*` and `API_JOBS_SECRET` as function secrets; append the names (no values) to `supabase/functions/.env.example`.
2. Trigger: pg_cron + pg_net with the secret in Vault, run by hand in the SQL editor (not a migration), or a scheduled CI job every 15 minutes calling the four routes in order.
3. Verify that the gateway forwards `Authorization` to the function with `verify_jwt = false`, and that the deploy bundles `@pactjoy/push` (out-of-tree import map, as for ADR-0011 S0.2).
4. Real iPhone over the https tunnel: every kind delivered once, with its deep link and quiet hours respected.

## References

- [ADR-0008](0008-use-case-and-port-conventions.md), [ADR-0009](0009-time-model-in-packages-app.md), [ADR-0010](0010-postgres-adapter.md), [ADR-0011](0011-api-layer.md), [ADR-0012](0012-web-client-architecture.md), [ADR-0013](0013-pause-lifecycle-and-lazy-settlement.md), [ADR-0016](0016-evidence-storage-port-s3-adapter-upload-ledger.md)
- RFC 8030 (Web Push), RFC 8188 (aes128gcm), RFC 8291 (Web Push encryption), RFC 8292 (VAPID)
- SDD change `scheduled-jobs-notifications` (proposal, spec, design and tasks in the project's Engram memory)
