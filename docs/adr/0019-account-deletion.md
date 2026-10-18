# ADR-0019: Account deletion with tombstoned shared history

- **Status:** Proposed
- **Date:** 2026-10-18
- **Deciders:** Product owner

## Decision

Account deletion is immediate after typing `ELIMINAR`, with no undo or grace
period. One app transaction leaves the active circle, erases private data,
hides shared commitments, tombstones every membership, and removes fully
erased circle trees. Photo object deletion and auth identity deletion run
**after commit**, with identity deletion last.

| Data | Disposition |
| --- | --- |
| Auth identity, habits, reviews/SRBAI, closures/decisions | Delete |
| Push subscriptions (D1) and commitment reminders (D2) | Delete |
| Graduation feed items and all reactions targeting them | Disappear/delete, including peers' reactions; no pseudonymous graduation record |
| Invites created by the member | Delete (owner decision overrides the earlier keep proposal) |
| Entry values, dates, scoring history | Keep; erase notes, photos, request fingerprints and client request IDs, including tombstones |
| Membership | Keep stable member ID, rotate auth user ID, empty display name, `left` status and `erasedAt` |
| Commitments | Hide detail with a version-checked season save: privacy `private` and the typed `customLabel` of the measure set to null; scoring fields unchanged |
| Pauses | Clear note and set reason `other` with a version-checked save; scoring unchanged |
| Received encouragements, viewer/target dismissals, outbox rows addressed to the member | Delete; all outbox states, not just pending |
| Sent encouragements and the member's own reactions to peers' items | Keep, pseudonymous |
| Circle whose every member row has `erasedAt` (earlier leavers included) | Delete the entire tree in FK-safe order; a non-erased earlier leaver keeps the circle (spec A1) |

### Use case and order

`deleteAccount(deps, actor, {confirmation})` (`packages/app/src/account/`)
checks `confirmation.trim() === "ELIMINAR"` before any I/O, then runs one unit
of work (`eraseAccount`): list every non-erased membership, leave the active
circle through `leaveCircleCore` (today's leave semantics), tombstone each
membership with its invite removed, hard-delete each fully erased circle
(`hardDeleteCircle`: entries, photo ledger, pauses, reviews, closures, outbox
by circle, reminders, reactions, encouragements and dismissals, seasons, then
the circle), then the member-wide helpers. Each helper lives inside its
owning module, so the existing guards stay intact. Entries are erased before
photos are released (`entries.photo_id` is RESTRICT). After commit,
`IdentityAdmin.deleteUser(originalUserId)` runs first; once it succeeds, a
second transaction runs the whole erasure again by the original user id
(`eraseAccount`, not only the user-level deletes), so nothing the still-valid
access token wrote in between survives: devices, habits, outbox rows, and also
a circle it created or joined once the first transaction left it without a
membership. Its released and dropped photo rows are purged like the first
one's. Then the member's released photos (including ones
released before the deletion) are purged in bounded batches and the objects
of dropped rows deleted, best effort and never thrown; leftovers stay
`released` for the global sweep job.

Peers' points are unchanged: the erased member is a left member, exactly as
after `leaveCircle`, so the standings drop her like any leaver and her own
scores stay readable as "Miembro que salió" with hidden commitments. The
Postgres sentinel compares every peer read model with an ordinary leave.

### HTTP

`DELETE /me` with the JSON body `{confirmation}` (a route-level opt-in lets
this one DELETE carry a body; every other DELETE still rejects one). 200
`{data: null}`; 422 `InvalidRequest` (missing, wrong type or unknown field)
or `ConfirmationMismatch`; 409 `ConcurrencyConflict`; 503
`IdentityUnavailable` when the data is erased but the identity call failed
(a retry repeats only that call). `API_AUTH_ADMIN_KEY` is optional: without
it the route answers 503 `ServiceUnavailable` before any write, so the rest
of the API keeps working until the owner sets the secret. Only the user JWT
strategy reaches the route; the jobs secret never does.

### Web

Ajustes has a danger row "Eliminar cuenta" (disabled offline) that opens a
sheet: the button stays disabled until the field reads `ELIMINAR` after
trimming, while the request is pending and offline; an error keeps the word
and offers "Reintentar" with the same call. On success the session ends
locally with no remote logout (the identity is gone): store, query cache,
persisted client and device session keys are cleared, this device's Web Push
subscription is dropped best effort, and the login screen says "Tu cuenta se
eliminó". An empty (or null) display name renders as "Miembro que salió"
through one helper, `shared/member-name.ts`, at every peer-name site; the feed
keeps its "Un miembro que salió" copy. `CACHE_VERSION` does not change.

### Coverage guard

`packages/db/test/erasure-coverage.ts` registers every person column and
every free-text or JSON column of every migration with a rule (`delete`,
`anonymize`, `keep`) and the reason. The guard parses all migrations, ALTERs
included, and fails on an unregistered or stale column, or on a table the
sentinel does not seed. `account-deletion.pg.test.ts` seeds every table with
`SENTINEL-` strings and proves on Postgres that no row keeps the original
user id, a sentinel string or an object key afterwards, that a retry writes
nothing, and that peers' read models equal an ordinary leave.

## Context

Peers' points must not change when someone deletes an account. Private habit,
review, evidence and auth information must nevertheless disappear. The app
owns `IdentityAdmin`; only the API adapter understands GoTrue HTTP. No vendor
SDK or secret belongs in the app, engine, database adapter or browser.

The transaction must not make network calls. A committed tombstone rotates
the auth UUID, so a retry finds no memberships and repeats the idempotent
identity deletion. An identity failure is sanitized and reported as
`IdentityUnavailable`; it cannot roll back the committed data erasure.

## GoTrue contract and S0 substitution

The adapter receives the Edge Function's `API_AUTH_ADMIN_KEY` by dependency
injection. It sends `DELETE /auth/v1/admin/users/<id>` with JSON
`{"should_soft_delete":false}` and `Content-Type: application/json`.
The `apikey` header carries the injected value, and nothing else does: the
key must be the project's opaque secret key. A JWT-shaped value (a legacy
service-role key) is refused by `loadApiEnv` with a name-only error, so the
legacy key can never be used for this.

| Outcome | Adapter result |
| --- | --- |
| 200, 204 | Success |
| 404 whose body is GoTrue's user-not-found | Success; an absent user counts as done on retry |
| Any other 404 (wrong URL, gateway route missing) | `IdentityAdminError("unavailable")` |
| 401, 403 | `IdentityAdminError("rejected")` |
| Other status, network failure, timeout, redirect | `IdentityAdminError("unavailable")` |

The default timeout is 5 seconds. Redirects are rejected, not followed.
Neither the upstream body nor a transport exception/cause is propagated.

**Orchestrator-approved S0 replacement:** no live GoTrue/Kong spike and no
credential discovery. Local HTTP stub contract tests exercise injected fetch,
the exact request, status mapping, timeout and redirect non-forwarding.
These tests do **not** claim to prove a deployed gateway's configuration,
token revocation, or the served function's DELETE-body handling.

Owner-only release checks (also required in the eventual PR body):

- [ ] local smoke: delete a test user through the served function with API_AUTH_ADMIN_KEY set, then confirm the auth user is gone
- [ ] Append the `API_AUTH_ADMIN_KEY` name to the function environment example and configure the secret securely.
- [ ] Verify hosted admin/gateway integration and refresh-token rejection after deletion.
- [ ] Verify the flow on a real iPhone and approve the Spanish confirmation/error copy.
- [ ] Use the opaque secret key (not a legacy JWT key) as `API_AUTH_ADMIN_KEY`; confirm a repeat delete answers GoTrue's user-not-found 404 through the gateway.
- [ ] Trigger `POST /api/jobs/sweep-entry-photos` on a schedule, and add a bucket lifecycle rule for objects with no ledger row.

## Alternatives considered

| Alternative | Tradeoff and decision |
| --- | --- |
| Delete shared entries | Simpler erasure, but rewrites peers' standings; rejected |
| Retain pseudonymous graduation facts | Preserves announcements, but adds a privacy exception and storage surface; owner chose deletion |
| Several transactions or network I/O inside the transaction | Easier sequencing, but risks partial erasure or locks held over network calls; rejected |
| Database access to auth tables | Avoids HTTP, but leaks identity-provider authority into the DB adapter; rejected |
| Delayed deletion or grace period | Allows recovery, but conflicts with immediate deletion; rejected |
| Read-time hiding only | Less writing, but every new read model must carry the privacy rule; versioned write-time hiding chosen |

## Consequences

- Shared scoring IDs remain stable; peers lose personal detail, not points.
- Notices queued to peers stay: their params are ids only, and dispatch drops
  the ones whose subject is gone or whose sender left (ADR-0017, ADR-0018 F17).
- The access JWT can remain cryptographically valid until expiration. Rotated
  memberships remove access to old circle data, and the post-identity cleanup
  removes what the token wrote before the identity was gone. A write after
  that cleanup (a new habit or device under the dead uuid, until the token
  expires) remains a documented residual; a denylist is out of scope.
- `DELETE /me` asks for no recent login: a stolen access token plus the
  constant word is enough. Accepted for the MVP (the word guards against
  mistakes, not attackers); re-authentication is a follow-up.
- A presigned upload that lands after its pending ledger row was released and
  purged leaves an opaque object with no row. A bucket lifecycle rule for
  objects with no ledger row (or an upload TTL shorter than the purge) closes
  it; it is on the ops checklist.
- The client clears its session and caches without a remote logout call.
- Storage deletion is best effort. Released ledger rows are retried by the
  sweep; a failed object delete after full-tree removal can leave an opaque,
  unreachable object requiring operational reconciliation.
- Backups retain data until their normal rotation; immediate backup purge is
  outside this change. Signing up again receives a fresh auth UUID.

## References

- [GoTrue admin user endpoint (official OpenAPI)](https://github.com/supabase/auth/blob/master/openapi.yaml) — `DELETE /admin/users/{user_id}`; the gateway adds `/auth/v1`.
- [GoTrue hard/soft deletion implementation](https://github.com/supabase/auth/blob/master/internal/api/admin.go) — `should_soft_delete` request field.
- [Supabase admin deleteUser reference](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser) — server-only deletion and hard-delete default.
- [Supabase API key header guidance](https://supabase.com/docs/guides/api/api-keys#known-limitations) — opaque keys use `apikey`, not Bearer.
- ADR-0008 (app ports), ADR-0010 (transactions), ADR-0011 (HTTP), ADR-0016 (photo lifecycle), ADR-0017 (outbox), ADR-0018 (derived feed).
- Binding owner decisions in Engram: #6048, #6054, #6060, #6088 and #6097; S0 substitution #6103.
