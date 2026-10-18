# ADR-0019: Account deletion with tombstoned shared history

- **Status:** Proposed
- **Date:** 2026-10-18
- **Deciders:** Product owner

## Decision

Account deletion is immediate after typing `ELIMINAR`, with no undo or grace
period. One app transaction leaves the active circle, erases private data,
hides shared commitments, tombstones every membership, and removes fully
erased circle trees. Photo object deletion and auth identity deletion run
**after commit**, with identity deletion last. These are the agreed target
semantics; the foundation commit does not yet expose a deletion endpoint.

| Data | Disposition |
| --- | --- |
| Auth identity, habits, reviews/SRBAI, closures/decisions, subscriptions | Delete |
| Graduation feed items and all reactions targeting them | Disappear/delete, including peers' reactions; no pseudonymous graduation record |
| Invites created by the member | Delete (owner decision overrides the earlier keep proposal) |
| Entry values, dates, scoring history | Keep; erase notes, photos, request fingerprints and client request IDs, including tombstones |
| Membership | Keep stable member ID, rotate auth user ID, empty display name, `left` status and `erasedAt` |
| Commitments and pauses | Hide commitment detail with version-checked privacy saves; clear pause note/reason without changing scoring |
| Received encouragements, viewer/target dismissals, recipient outbox | Delete; all outbox states, not just pending |
| Sent encouragements and other shared reactions | Keep anonymously |
| Circle whose every member is erased, including earlier leavers | Delete entire tree in FK-safe order |

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
The `apikey` header always carries the injected value. Opaque keys are not
JWTs and are never sent as Bearer tokens; only a JWT-shaped injected value
also produces `Authorization: Bearer <value>`. This compatibility branch is
tested with a deliberately synthetic string, not a real credential.

| Outcome | Adapter result |
| --- | --- |
| 200, 204, 404 | Success; absent user counts as done on retry |
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
- The access JWT can remain cryptographically valid until expiration. Rotated
  memberships remove access to old circle data. A denylist is out of scope;
  creating fresh resources under a stale token remains a documented residual.
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
