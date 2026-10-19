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
- **Server state with TanStack Query, confined.** TanStack is allowed only in `src/composition`, `src/shell/ErrorBoundary.tsx`, `src/features/*/queries.ts` and the persister adapter. Mutations invalidate Today and progress; refreshed season series also invalidate Today. The shared season-local clock refreshes both at midnight and catches up on resume. There is no optimistic scoring.
- **Auth through GoTrue REST, no SDK.** Four `fetch` calls (`/auth/v1/otp`, `/verify`, `/token?grant_type=refresh_token`, `/logout`) behind `AuthPort`, with the anon or publishable key only (never the service role key). `supabase-js` is rejected as a vendor SDK inside the client.
- **Tokens in `localStorage`** behind `TokenStore`, with a cross-tab `storage` subscription (refresh tokens rotate). Risk: XSS can read them. Mitigations: no `dangerouslySetInnerHTML`, a CSP later. Moving to another store is a new adapter.
- **Errors.** Adapters throw `ApiError` (TanStack's contract). One exhaustive `toUiError` table, checked at compile time with `satisfies Record<KnownCode, UiKind>`, maps every API code to a UI behaviour.
- **Design system CSS vendored verbatim** with a provenance header and a sha256 manifest. The test that verifies the hashes lands with the CSS itself (not yet in the repository). Whether the tokens and `components.css` count as brand identity under `TRADEMARKS.md` is an open owner decision (P9); until then the slices that vendor them stay on local branches.
- **Biome only.** No oxlint or ESLint: the adherence rules are ported as Biome rules plus guard tests. Biome 2.5 has no type-only import option, so `apps/web/test/boundary.test.ts` enforces `import type ... from "@pactjoy/app"` for every `@pactjoy/*` import and re-export (dynamic imports included), keeps `globalThis.fetch` and `window.localStorage` inside `src/adapters`, and keeps `import.meta.env` inside `src/config.ts`.
- **TypeScript 7 constraint.** No tool that loads the TypeScript JS API: vite-plugin-checker, vite-plugin-dts, typescript-eslint, ts-node, react-docgen-typescript and Vitest `typecheck` mode are banned. Type checking is `tsc --noEmit`.
- **Offline is read-only, except entry writes.** The last successful Today is persisted (only `["today"]`, 24 h) and shown with a banner. Every write except entries is disabled while offline. Entry writes (record, "Hoy no salió", edit, delete) are kept on the phone and sent on reconnect: P1 was reversed on 2026-10-18, see the addendum "Offline entries".

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
- No offline writes: a user without a connection cannot register. (Reversed for entries on 2026-10-18: see the addendum "Offline entries".)

### Neutral

- Guard tests complement Biome where Biome has no rule.

## Provisional decisions

Recorded while the owner is unavailable; to be confirmed.

| ID | Provisional choice |
| -- | ------------------ |
| P1 | ~~Offline read only, no write queue~~ Reversed for entry writes by the owner on 2026-10-18 (addendum "Offline entries"); every other write stays offline-disabled |
| P2 | Additive API fields (`pendingYesterday`, `category`, `recordedAt`, weekly count, week close date) deferred; their visuals are hidden |
| P3 | No per-entry points in the UI; server-confirmed progress only |
| P4 | No dark mode |
| P5 | Brand imagery and logo not committed; neutral placeholders |
| P6 | Four tabs; Temporada, Círculo and Perfil are stub routes |
| P7 | Dev seed through the API against local Supabase only |
| P8 | Placeholder Spanish copy for error toasts |
| P9 | Design-system CSS is not published until the owner decides on the brand question |

## Addendum: onboarding, circle and profile (change `pwa-onboarding-circle-profile`)

New browser capabilities follow the same rule as the first ports: a port in `src/ports`, one adapter in `src/adapters`, a context in `src/context`, a fake in `src/testing`.

| Port | What it hides | Notes |
| ---- | ------------- | ----- |
| `Sharing` | Web Share API and clipboard | The UI hides "Compartir" when `canShare()` is false |
| `AppInstall` | Display mode, platform, `beforeinstallprompt` | iOS has no prompt: `InstallStep` explains the Share menu. The step shows wherever the browser can install (iOS, or any browser that fired `beforeinstallprompt`, desktop Chrome and Edge included) and never in an installed app |
| `NotificationPermissionPort` | `Notification.permission` and `requestPermission` (promise and old callback forms) | Permission only: no subscription, nothing sent until push (change D). Biome bans the `Notification` global outside adapters, and `boundary.test.ts` bans `window.Notification` |
| `DeviceStore` | `localStorage` flags and drafts | A closed key union, so a typo is a compile error |

**Device versus session storage.** Device flags describe the phone and survive sign out: `welcomeSeen`, `installStep`, `notificationStep`. Only `nameDraft` is personal, so only it is cleared when the session ends (`clearSession`, called from the composition's `onSessionEnd`). Otherwise the pre-login carousel would return on every login. On iOS the installed app has its own storage, separate from Safari, so the carousel and the install step run before login and the permission step after it (the user taps it inside the installed app).

**Who sees the permission step (owner decision, 2026-10-04).** Every user sees it once, on their first standalone launch after login, members included. Permission belongs to the device, not to the circle, and the step does not wait for `/me/circle`, so it also works offline. It is shown only when the app runs standalone, the permission is `default` and `notificationStep` is not set; any answer, even a refusal or "Ahora no", sets the flag. `NotificationPermissionPort.request()` must start synchronously inside the tap (no `await` before it) and never rejects.

**Feature dependencies.** `test/architecture.test.ts` holds `ALLOWED_FEATURE_DEPS`; any cross-feature edge not listed fails, and a feature is reached only through its `index.ts`.

| Feature | May depend on |
| ------- | ------------- |
| `today` | `entry` |
| `profile` | `auth`, `circle` |
| `circle` | `onboarding` |
| `entry`, `auth`, `onboarding` | nothing |

**`Serialized<T>`.** App views use domain types (`Instant`). `src/ports/wire.ts` maps `Instant` to its ISO string recursively, so the client types a response with a type-only import and never copies a wire shape by hand.

**`myCircle` is not persisted offline.** Only `["today"]` is persisted. A saved `myCircle` would restore a stale `noCircle` or circle after a leave or join. `CACHE_VERSION` changes for persisted shape, scoring semantics or newly persisted keys; v5 purges pre-T0 ended-season scores and stale weekly-series figures. Progress responses are not persisted. Weekly-summary dismissal stores only a device-local MemberId/season/week flag, surviving session clearing without storing summary data; opening consumes it, and the season-local day boundary hides it.

## Addendum: first full week celebration (2026-10-18)

Owner definition: the first final season week with every active opportunity kept, across all of the viewer's commitments. Minimum is enough, pauses are excluded, at least one opportunity is required, and both the week grace and opportunity deadlines must have expired. Eligibility is derived by the app from exact engine results and sent as an optional nullable `firstFullWeek` index in Today; older payloads fail closed. No new feed event or push is emitted.

Today shows a private accessible celebration only for a view the server returned in this runtime, across remounts (marked by the shared `todayQuery`), while online and not refreshing; never for cache hydration, a view written locally or a failed refresh. Opening consumes `first-full-week-seen:<member>:<season>` on this device, matching the weekly-summary flag policy; each new season can celebrate again. The Sheet retains focus/Escape behavior, the Together ribbon honors reduced motion, and acknowledgement uses the optional haptics port. Persistence denial falls back to the device adapter's in-memory flags.

Derived Spanish copy, pending owner approval: “Tu primera semana completa”; “En la semana {N} cumpliste tu mínimo en todas tus oportunidades activas.”; “Seguir con mi día”. Real-iPhone and live design-fidelity checks remain owner checks; the shipped components/tokens and cached design inventory were reused because the private project could not be inspected live.

## Addendum: season timezone (change `pwa-season-habits-pact`, D7)

**Owner decision, 2026-10-07.** Circles have no timezone. At season creation the client captures the creator's device IANA timezone and sends it with the start date. That timezone is stored on the season and stays fixed for its calendar; a subsequent device timezone change does not change it. The default start is tomorrow in this season timezone, with the editable date window resolved in the same zone. This corrects D7's earlier wording, "circle timezone", without changing the existing implementation.

## Addendum: Perfil reaches habits and review (change `profile-habits-consistency`)

`profile` gains two feature edges in `ALLOWED_FEATURE_DEPS`: `habits` (for `HabitGlyph`, the habit tile) and `review` (for `HabitStageTag`, the stage badge), both through their `index.ts`. Both are leaf features that never import `profile`, so there is no cycle. The alternative, copying the stage label map and the icon catalog into `profile`, would let the copy drift from the badge on screen 17. The summary query (`profileSummaryKey`) lives under the progress root, so every settled entry, pause, review, closure or pact mutation refreshes it; it is not persisted, so `CACHE_VERSION` does not change. The table above is the original onboarding-era list; `test/architecture.test.ts` is the source of truth.

## Addendum: entry photos (change `photo-evidence`, ADR-0016)

The web side adds two ports and no new vendor in a screen: `ImageProcessor` (a picked file in, a JPEG of at most 1600 px and 3 MiB out; the canvas re-encode is what drops EXIF and GPS) and `PhotoUploader` (the signed PUT to the storage origin, with the signed headers only: never `Authorization`, never cookies). Both are adapters (`canvas-image-processor`, `fetch-photo-uploader`) provided through `PhotoProvider`; the picker is a plain `<input type="file">` inside `PhotoField`, with no `capture`, so the phone offers camera and library. `PactJoyApi` gains `requestPhotoUpload`; record and edit carry `photoId` (an edit that omits it keeps the photo). `entry` still depends on no other feature: `EvidencePhoto` is shared in `ui/`, and the commitment screen refreshes its read through `useRefreshCommitmentProgress` (the `season-progress-data` hook) when a signed link has expired. `CACHE_VERSION` is 9: the persisted Today now holds signed photo URLs, which expire after 10 minutes, so a restored copy shows "Foto no disponible" and refetches once instead of a broken image; `isCurrentToday` also drops a copy whose entries have no `photo` field. Photos are offline-disabled, like every write.

## Addendum: Web Push (change `scheduled-jobs-notifications`, ADR-0017)

- **Service worker.** vite-plugin-pwa moves from `generateSW` to `injectManifest` with a hand-written `src/sw.ts`. It keeps what the generated worker did: `precacheAndRoute(self.__WB_MANIFEST)`, `cleanupOutdatedCaches`, `skipWaiting` + `clientsClaim` (the `autoUpdate` behaviour) and one `NavigationRoute` to `/index.html` that refuses the API paths. There is still no runtime caching. The shared values (`GLOB_PATTERNS`, `NAVIGATE_FALLBACK`, `NAVIGATE_FALLBACK_DENYLIST`) live in `src/sw/shell-config.ts`, read by both `pwa.ts` and the worker, so the PWA test asserts what both use. On `push` the worker always shows a notification (iOS requires it); on `notificationclick` it focuses an open window and navigates it, or opens one, and only ever to a same-origin path.
- **Copy and destinations** are pure modules (`src/sw/push-payload.ts`, `src/sw/notification-copy.ts`): `{v: 1, kind, params}` becomes a Spanish title, body, tag and path; anything unknown or malformed is the generic notice opening `/`. Ids are encoded as single path segments. Pause requests open the Circle tab (approvals are answered there), the pact opens `/season/:id/pact`, a review opens `/review/:id/:period`, and the results day opens Today, whose season-close card leads to the closing review or the close flow, whichever is next. Derived copy, approved by the owner at the real-iPhone check.
- **Port.** `PushSubscriptionPort { supported, current, subscribe, unsubscribe }`, adapter `browser-push-subscription` over `serviceWorker.ready.pushManager` (always `userVisibleOnly`), fake in `src/testing`. `PactJoyApi` gains `getPushConfig`, `savePushSubscription` and `removePushSubscription`.
- **Feature `notifications`** (no dependency on other features; onboarding and profile depend on it): `enablePush` starts the permission request synchronously inside the tap, then subscribes and registers; `PushSync` (rendered by the composition with the signed-in user's id) re-syncs once per user and start, resubscribing after a VAPID key rotation and removing a subscription whose permission was revoked; `removeThisDevice` runs from `SessionProvider.beforeSignOut`, before the tokens are cleared. One sync runs at a time per device. Ajustes gains an "Avisos" group (`NotificationsCard`): Activadas, Desactivadas with "Activar notificaciones" (offline-disabled), Bloqueadas with a pointer to the phone's settings, or No disponibles (with "install the app" in a browser tab). The permission step's copy now says what the notices are for.

## Addendum: offline entries (change `offline-entries`)

**Owner decision, 2026-10-18; reverses P1 for entry writes.** The MVP definition in Notion ("Sin conexión") requires that entries recorded without a connection are kept on the phone and sent on reconnect. Record (done, quantity), "Hoy no salió", edit and delete are covered. Photos, pauses, reviews, reactions, the pact, the season close and the profile stay offline-disabled. The change is client-only: no server contract, no migration.

**Owner answer (Q1, 2026-10-18, option A).** A session that ends on its own (the refresh token expired or was revoked) keeps the outbox, queue and notices, under `pactjoy.outbox.v1:<userId>`. Nothing is replayed while signed out, and the queue is replayed when the same user signs in again, as on app start. The outbox is still erased on an explicit sign-out (after its grace send), on account deletion, and when a different user signs in on this device: that user's sign-in erases every other user's outbox before the new session starts, so one user's queue is never sent with another's token. The other erasure on expiry (cached data, reminder names, the name draft) is unchanged.

**Provisional defaults, pending owner confirmation.** These were taken so the change could ship; they are not owner decisions yet and may change. Q2: the server's truth wins; an entry that arrives after its window closed is rejected, removed from the queue and listed in a notice that stays until the member dismisses it. Q3: `OpportunityOnHold` is terminal and listed like the rest, with a line that the entry can be recorded again if the pause is rejected.

**Send or queue.** The mutation functions in `features/entry/queries.ts` decide per command. It goes straight to the API when the device is online and the outbox is empty; it is handed to the outbox when the device is offline, when the outbox already holds items (to keep their order), or when a direct send is lost (`NetworkError`; no "Reintentar" error). A command that carries a `photoId` is never queued: its upload slot (`attachBy`) expires and a stale slot would turn the whole entry into `PhotoUploadExpired`, so the photo field is disabled offline ("La foto necesita conexión.") and a lost answer with a photo keeps the retry toast. A queued record always carries `forDate`, the day the member saw (Today's `refDate`), so a replay after midnight still lands on that day; a record with no known day is not queued. The day on display must still be today, though: when the view's day is behind the phone's season day and the server cannot vouch for it (the view was restored from storage, or the connection is lost), Today takes no registro for it and says "Hoy todavía no se cargó; conéctate para registrar." Otherwise a tap made offline after midnight would be kept for yesterday, which the server would still accept inside its grace. The explicit De ayer choice stays available. While the server answers, its day wins over a phone clock that runs ahead. Edits and deletes carry `actedAt`, when the member acted: an edit whose direct send was cut off reaches the queue only when its request fails, and it never replaces a later edit of the same entry nor follows a later delete of it, whether that later write is still queued or already reached the server directly (the outbox remembers, in memory, when the last direct write of each entry was made). A late delete is not ordered this way: it is the member's later intent for the entry. An outbox whose session is over refuses to queue, so the write shows its error instead of a false "saved on this phone". The rows also stay closed while a refetch is out, so the day-change refetch must answer before the new day can be recorded. A refetch that fails, for any reason, closes that day. Known window: with the app open and online across midnight, a tap still goes out for the day on display in the half second before the day watcher notices the new day (its slack) and starts that refetch.

**Outbox.** `OutboxStore` is a port in `src/ports`; `LocalStorageOutboxStore` keeps one list per user under `pactjoy.outbox.v1:<userId>`, with a memory fallback when storage throws (the memory copy is the newer one and wins on read until another tab writes or clears the key) and a `storage` event subscription so a second tab follows. An `Outbox` follows the store from `activate()` (called by the provider's effect, so an instance React discards subscribes to nothing) until `dispose()`, whether or not anything on screen listens, and reloads its state on each store event; it is disposed when its user changes or the tree unmounts, and a disposed outbox never writes. Every change reads the store first and saves the result in the same synchronous step (read-modify-write), never from the outbox's own copy: another tab's write may be stored before its `storage` event arrives. This narrows the cross-tab race; it does not remove it. Browsers do not lock `localStorage` between tabs, and an enqueue does not take the replay lock below, because a replay holds it across network requests and a save on the phone must not wait for them. What is left is a lost update between two tabs writing within the same instant. The outbox also stops, and stops writing, as soon as the stored session belongs to another user, before React has disposed it. `Outbox` (`features/entry/outbox`) is the replay engine; `queue.ts` (coalescing), `classify.ts` (outcome classes), `notices.ts` and `overlay.ts` are pure. Items: `record`, `edit`, `delete`; a target is a server `entryId` or a local reference `local:<localId>`. A record is `attempted` once a send for it started, persisted BEFORE the request; a record queued because its direct send was cut off (`NetworkError`) is queued as attempted from the start, because that request may already have reached the server. A never-attempted record is rewritten in place by an edit (same `clientRequestId`) or removed by a delete (nothing is ever sent); an attempted one may already be on the server, and rewriting it would change its fingerprint and answer `IdempotencyKeyReused` (422), so edits and deletes of it wait behind it as dependants, retargeted to the real `entryId` once it is sent. The last edit of a target replaces the earlier one; a delete drops the queued edits of its target. The edit is the existing full-state `PUT` and the delete is idempotent, so no new idempotency key is needed (the owner edits only their own entries; last write wins).

**Replay.** One item at a time, in order. A second `drain()` in the same tab joins the first, and the tabs take turns under a Web Lock named `pactjoy.outbox:<userId>` (an `ExclusiveLock` port, `WebLocks` adapter; where the platform has no Web Locks the replay runs without one, and the server's idempotency absorbs a duplicate request). It starts with the session at app start, on `online`, when the app becomes visible, right after an enqueue while online, and with backoff (5 s, 15 s, 60 s, then every 5 min) while retryable items remain. Each answer is classified, status first: no answer (0), 429 and any 5xx are retryable whatever code they carry. Then: sent (a record that answers `replayed: true` counts as sent; a delete that answers `EntryDeleted` or `EntryNotFound` counts as sent); retryable (`NetworkError`, `ServiceUnavailable`, `Internal`: stop, keep the rest); conflict (`ConcurrencyConflict`: one attempt and three retries 500 ms apart, then terminal); session (`Unauthorized` after the refresh: stop, the session-end rules apply); terminal (every other code): the item and whatever waits for it leave the queue into one notice (habit, day, action, reason) and the replay goes on (a rejected record the member had also deleted leaves no notice: it is gone as they wanted). After a replay that changed anything, the composition invalidates Today, the season progress reads and the circle feed: the server stays the only source of points. `Outbox.replaying()` feeds the "Enviando…" line; `Outbox.resolve()` maps a `local:` reference held by an undo toast to the server entry once its record was sent (memory only).

**Today.** `overlayToday` lays the queue over the server's view without changing anything the server scores: a queued record adds a local entry (`local:<id>`, `photo: null`), an edit replaces the value shown, a delete hides the entry, and the rows carry a pending mark (design 15g: filled circle, "Registrado en este teléfono", badge "Pendiente de sincronizar", a footnote that points and standings update on sync). A record that was sent stays laid over the view, under its real `entryId` and still marked pending, until a Today fetch that STARTED after its send has resolved (the outbox keeps it in memory with a monotonic `tick()` stamp; every read of Today goes through the one `todayQuery`, whose query function stamps the fetch the same way and also marks the answer as the server's for the first full week celebration, which reads the server's view and never the overlay), found or not: Today rows only hold entries whose edit window is open, so waiting to see the entry could leave a phantom pending entry forever. The row never looks open between the send and that refetch, and a fetch that began before the send settles nothing. Row state, earned points, week progress, the counts and the standings are the server's. There is no optimistic scoring: the engine stays server-side, as this ADR already required. A rejected item becomes a calm notice card ("No pudimos enviar un registro" / "…{n} registros") that persists until "Entendido".

**Erasure.** `SessionProvider` passes `onSessionEnd` why the session ended (`signedOut`, `expired`, `accountDeleted`, or `elsewhere` for another tab), and the composition calls `outboxStore.clearAll()` only for a sign-out or an account deletion (Q1). An expiry keeps the outbox; the outbox of a session that ended is disposed, so nothing is sent while signed out, and the next outbox for the same user replays the queue as on app start. Every sign-in, here or seen from another tab, first calls `onSessionStart(userId)`, which runs `outboxStore.clearExcept(userId)` before the session is saved or shown. A sign-out in another tab is `elsewhere`: this tab cannot tell it from an expiry, so it leaves the outbox to the tab that ended the session, whose `clearAll` reaches this tab through the `storage` event. Known gap: a memory-only copy in this tab (its storage refused the write) outlives another tab's sign-out until the next sign-in of a different user. `clearAll` and `clearExcept` also tell this tab's subscribers, and every outbox follows the store for its whole life, so an outbox that is mid-replay reloads the empty state, sends nothing more and never writes its state back (the request already in flight cannot be recalled, but its answer is dropped). Before an explicit sign-out the client first sends the queue (Ajustes waits up to 2 s, the length of the sign-out grace) and, if entries remain, asks ("Tienes registros sin enviar") before erasing them. The sign-out itself then runs `beforeSignOut` within its own 2 s grace: the device's push removal and one last `drain()` side by side, through a ref the composition fills (the outbox renders inside `SessionProvider`). So "Cerrar sesión" can take up to about 4 s in the worst case. The push removal cannot start during the first wait, because the member may still cancel at the question. Since an expiry erases no entries, the login says nothing about them.

**Architecture.** `profile` gains the edge `entry` in `ALLOWED_FEATURE_DEPS` (Ajustes reads the outbox through `entry`'s `index.ts`); `entry` still imports no other feature and the edge adds no cycle. `CACHE_VERSION` stays "9": the persisted Today does not change shape, TanStack mutations are still never dehydrated, and the outbox is the only offline write store. `networkMode: "always"` stays; the outbox decides before the request.

**Rejected alternatives.**
- *TanStack persisted/paused mutations.* They are not serializable by design, cannot coalesce, would live in the Today blob that `CACHE_VERSION` busts, and re-run through a mutation cache that has no notion of ordering across commands.
- *IndexedDB.* Reads are asynchronous, which `useSyncExternalStore` and the sign-out/expiry paths would have to await; the data is a few small items per user; and the only thing IndexedDB would buy is access from a service worker, which cannot replay anyway (below). `localStorage` behind a port matches the device-store and token-store adapters; swapping the adapter later is a port change, not a domain change.
- *Background Sync / a service-worker replay.* WebKit does not implement Background Sync, and the worker holds no tokens, so it would duplicate the refresh logic. Replay runs in the page on start, `online`, visibility and enqueue.
- *Server idempotency keys or `expectedVersion` for edits and deletes.* Not needed: records already have `clientRequestId` plus a fingerprint, the edit is a full-state `PUT` by the entry's owner, and the delete is idempotent. Adding keys would be a contract change for a risk the coalescing rules already remove.
- *Honouring the device timestamp against the grace window.* The device clock is untrusted and Mechanics says the grace decides whether an entry arrives in time; the server's answer wins (Q2).
- *Queueing photos as blobs.* A photo needs a server-signed slot with `attachBy`; a stale slot would lose the whole entry.

**Follow-ups.** The same real-iPhone airplane-mode check as the other PWA changes; owner approval of the Spanish copy listed in the change. A replay of a `Conflict` is the only place where the number of retries is a guess. Known gap: the server checks membership before it looks up a replayed `clientRequestId`, so a record whose first send landed (its answer lost) and is replayed after the member left the circle is rejected as "ya no se puede registrar en esta temporada", although the entry exists. It is rare, and the notice errs on the side of saying too little; it needs no client change.

## References

- ADR-0003 (Biome), ADR-0008 (ports), ADR-0011 (API layer)
- `TRADEMARKS.md`
