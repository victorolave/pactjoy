# ADR-0016: Evidence storage: app-owned port, S3-protocol adapter with hand-rolled SigV4 presigning, upload ledger

- **Status:** Accepted
- **Date:** 2026-10-13
- **Deciders:** Victor Olave

## Context

The MVP lets a member attach one optional photo to an Entry as evidence (design batch 1, screen 19). The Notion rules fix the product side: peers see the photo only on visible commitments, private commitments are owner-only, the photo never affects scoring, and it changes only inside the entry window like the note.

The technical forces:

- **Replaceable storage.** The guiding principle of CLAUDE.md applies: no vendor type, SDK or URL convention may reach `packages/engine` or `packages/app`.
- **Edge Function limits.** The `api` function should not carry image bodies (request size, CPU and cost). The browser must upload directly.
- **Never the service-role key.** It bypasses every Supabase control (Postgres through PostgREST, Auth admin, Storage). A leak would be total, so it must not sign uploads.
- **Orphans.** A direct upload happens outside any database transaction, so something has to track reservations that are never attached.
- **Privacy.** A signed URL contains the bucket and the object key. Anything derivable from ids would leak them to peers.

The storage spike (local Supabase CLI 2.119.0) verified: S3 presigned PUT, GET and HEAD work; a ranged GET answers 206; CORS answers `Access-Control-Allow-Origin: *`; a body that does not match a signed `content-length` gets 403; the bucket limits answer 413 (size) and 415 (type).

## Decision

### Port and key ownership

- **P1. App-owned port.** `EvidenceStorage` lives in `packages/app/src/ports/evidence-storage.ts`: `signUpload(key, {size, contentType}, ttl, now)`, `signDownloads(keys, ttl, now)`, `stat`, `readHead`, `delete`. The signed upload pins the exact size and type (`content-length` and `content-type` are signed headers). `now` is passed in so expiry follows the app `Clock` (ADR-0009), not the adapter's wall clock.
- **P2. Opaque keys.** An object key is `o/{32 lowercase hex}.jpg`, minted in the app from `RandomSource` and stored in `entry_photos.object_key` (UNIQUE). Keys are never derived from season, member or photo ids and never come from the client.

### Upload ledger

- **P3. `EntryPhoto` aggregate** (`entry_photos`): `{id, seasonId, memberId, commitmentId, objectKey, byteSize, status: pending | attached | released, createdAt, attachBy, version}`. The Entry carries only `photoId: EntryPhotoId | null` (aggregates reference each other by id, ADR-0010). `entries.photo_id` is UNIQUE: one photo maps to one entry.
- **P4. Verify outside the transaction, attach inside.** `uow.read` loads the row; then `stat` (size equals the reserved size, type `image/jpeg`) and `readHead(key, 3)` (must be `FF D8 FF`). The transaction then checks that the row is still `pending` at the verified version, belongs to the same member, season and commitment, and that `now < attachBy`, and saves `attached`. ADR-0010 forbids external effects inside `work`, and the version check closes the race between verification and attach; a concurrent double attach ends in `ConcurrencyConflict`.
- **P5. Timing invariant.** `UPLOAD_URL_TTL` (5 min) is strictly shorter than `ATTACH_WINDOW` (30 min, `attachBy = createdAt + 30 min`). No PUT can land after a pending row has expired and been swept, so the sweep cannot orphan an object. A pinned test asserts it.
- **P6. Release and purge.** Replace, remove and Entry delete set the old row to `released` in the same transaction as the Entry change. After commit, `purgeReleased` calls `storage.delete` (idempotent) and then hard-deletes the row (`WHERE status = 'released'`). Failures are swallowed and left to the sweep, so a failed delete leaves a `released` row, never a lost file.
- **P7. Lazy sweep, no job.** `requestEntryPhotoUpload` first runs `sweepEntryPhotos(deps, {memberId, limit})` best-effort: release expired pending rows, delete the objects of released rows, purge. At most 5 pending reservations per member whose upload URL is still live (`createdAt` within `UPLOAD_URL_TTL`; `TooManyPhotoUploads`, 409). A reservation whose URL is dead no longer counts, even before `attachBy`, so a member who discards draft photos is not locked out for the whole attach window. `sweepEntryPhotos(deps, {limit})` without a member is the global sweep that job D will trigger; no trigger exists yet.
- **P8. Reserve checks only** active member, own commitment, season `active` and the cap. It does not check the entry window, pause or on-hold: those need `forDate`, which the reservation does not have. `recordEntry` and `editEntry` are the authoritative gate; a reservation for a closed window simply expires.
- **P9. Missed rule.** A `missed` value with a non-null `photoId` is `PhotoNotAllowedOnMissed`, checked first and from input only. Editing an Entry to `missed` releases its photo; sending a new `photoId` with `missed` is rejected. Quantity 0 may carry a photo.
- **P10. Fingerprint.** `requestFingerprint(value, note, photoId)` appends the photo id only when it is non-null, so fingerprints of photo-less requests stay byte-identical and old idempotency keys still match. A replay with the same `photoId` returns the original result without re-validating.
- **P11. Edit semantics.** An edit that omits `photoId` keeps the current photo (cached web bundles keep working); `null` removes it; a new id verifies, attaches and releases the old one.

### Privacy and choke point

- **P12. Privacy.** `visiblePhotoId(entry, commitment, viewer)` sits next to `visibleNote` and reuses `canSeeDetail`. `photoViews(repos, storage, ids, now)` signs GET URLs (10 min) after filtering, so no URL is minted for a hidden photo. Peers receive `{url, expiresAt}` only; owner surfaces also get `photoId`. `objectKey`, `byteSize`, `attachBy`, `status` and the bucket name never reach a DTO.
- **P13. Choke point.** `repos.entryPhotos` and `EvidenceStorage` are used only inside `src/entry-photo/`, pinned by a guard test (same pattern as ADR-0014 and ADR-0015).

### Adapter

- **P14. `packages/storage`** is a new adapter package, not part of `packages/db`: ADR-0010 keeps `db` to the Postgres unit of work, and storage must be replaceable on its own. It is standard TypeScript/ESM (no `node:`, `npm:` or `jsr:`) and runs on Node and Deno.
- **P15. Two endpoints.** `endpoint` (server to storage: HEAD, ranged GET, DELETE) and an optional `publicEndpoint` (the host the browser uses for the presigned PUT and GET, which is the https tunnel for a phone). SigV4 signs the `Host`, so each URL is signed for the host that will be called.
- **P16. Presigned URLs for server calls too.** HEAD, ranged GET and DELETE use the same query-auth signer: one signing mode, no header-auth variant.
- **P17. Hand-rolled SigV4 on WebCrypto.** `crypto.subtle` and `TextEncoder` only, `UNSIGNED-PAYLOAD`, path-style `/{bucket}/{key}`, verified against the AWS documentation vectors. Tests run against SeaweedFS' S3 gateway through Testcontainers (like `packages/db`, ADR-0010; see the CI image note below), with `TEST_S3_ENDPOINT` and `TEST_S3_IMAGE` overrides, plus a manual smoke script against local Supabase for what only Supabase enforces (413, 415).

### Credential policy

The adapter uses the Supabase S3-protocol access key pair, which reaches Storage only: it cannot touch Postgres or Auth and can be rotated on its own. It lives only in function secrets (`API_STORAGE_S3_*`) and is never committed. The service-role key is neither used nor required, and a boundary test scans for it.

Portability: R2, AWS S3 or MinIO is a change of endpoint, region and keys only.

### Smoke against local Supabase Storage (2026-10-13, CLI 2.119.0, storage-api 1.79.28)

`packages/storage/scripts/smoke.ts` ran with the real adapter. Status codes only; 404 on a missing object means the signature was accepted, 403 `SignatureDoesNotMatch` means it was not.

| Check | Result |
| --- | --- |
| Bucket from `config.toml` | `supabase start` was not restarted; `supabase seed buckets` created `entry-photos` with its 3 MiB and `image/jpeg` limits |
| Public host `127.0.0.1:54321`: PUT, HEAD, ranged GET (206), GET, DELETE (204), delete twice | all pass |
| Size mismatch against the signed `content-length` | 403 |
| 3 MiB + 1 byte / `text/plain` (bucket limits) | 413 / 415 |
| Real Edge Runtime container (`edge-runtime:v1.77.1`, adapter imported out of tree), endpoint `host.docker.internal:54321` | all pass |
| Same container, endpoint `kong:8000` (and `api.supabase.internal:8000`, `supabase_kong_pactjoy:8000`) | 403 on every signed call |
| Same container, signed for `kong:54321` but connected to `kong:8000` | signature accepted |
| Emulated https tunnel (`Host: <tunnel>` through `127.0.0.1:54321`): signed `<tunnel>` / `<tunnel>:443` / `<tunnel>:54321` | 403 / 403 / accepted |
| Real Cloudflare tunnel | not testable from the build sandbox (no egress to Cloudflare) |

Cause: the local Kong in front of Storage sets `X-Forwarded-Host` to the requested host without the port and `X-Forwarded-Port` to a fixed `54321`, and Storage validates the signature against `<forwarded host>:<forwarded port>`; a `Host` or `X-Forwarded-Host` sent by the client has no effect. The host to sign for is therefore `<requested host>:54321`, whatever port the caller connects to. That holds for `127.0.0.1:54321` and `host.docker.internal:54321` by coincidence, and fails for `kong:8000` and for a tunnel host (the browser sends `Host: <tunnel>` with no port). This is a property of the local gateway; the hosted gateway has not been checked (see the operational checklist).

### Decision: a configurable signing host

The adapter takes two optional settings, `signingHost` (server calls) and `publicSigningHost` (browser URLs), each a `host[:port]` to sign for while the connection still goes to the endpoint URL (`presign({ signedHost })` swaps only the signed `Host`; the returned URL is untouched). Unset, it signs for the host it connects to, which is right for AWS S3, R2, `127.0.0.1:54321` and any hosted gateway that does not rewrite the host. The environment names for the API are `API_STORAGE_S3_SIGNING_HOST` and `API_STORAGE_S3_PUBLIC_SIGNING_HOST` (values are `host:port`, never a URL). Locally, with the Edge Function reaching storage through Kong, `API_STORAGE_S3_ENDPOINT=http://kong:8000/storage/v1/s3` pairs with `API_STORAGE_S3_SIGNING_HOST=kong:54321`, and a phone on a https tunnel `t` pairs `API_STORAGE_S3_PUBLIC_ENDPOINT=https://t/storage/v1/s3` with `API_STORAGE_S3_PUBLIC_SIGNING_HOST=t:54321`. If `API_STORAGE_S3_PUBLIC_ENDPOINT` is not set, the browser URLs use the server endpoint and its signing host.

Re-run of the smoke with the override (same day):

| Check | Result |
| --- | --- |
| Real Edge Runtime container, endpoint `kong:8000`, `signingHost` `kong:54321`: PUT, HEAD, ranged GET, GET, DELETE twice, 403 size mismatch, 413, 415 | all pass |
| Same container, endpoint `kong:8000`, no `signingHost` (control) | 403 on the server calls |
| Emulated https tunnel (`Host: tun.test` through `127.0.0.1:54321`), `publicSigningHost` `tun.test:54321`: PUT, GET, then HEAD from the server side | 200, 200, found |
| Same, no `publicSigningHost` (control) | 403, 403, not found |
| Host smoke, `127.0.0.1:54321`, no override | all pass |

The hosted Supabase gateway is not covered: whether it validates the forwarded host or the real one is checked at deploy time (operational checklist), and the same two settings absorb either answer.

### CI image for the S3 contract tests

The contract suite needs a real S3 server that validates SigV4 query presigns (including a signed `content-length`, so a body of another size is a 403), answers path-style PUT, HEAD, GET with `Range` (206) and DELETE. `minio/minio` (Docker Hub) and `quay.io/minio/minio` no longer allow anonymous pulls (`denied` / `401`), which is all a GitHub Actions runner has. Evaluated on 2026-10-13 with an empty `DOCKER_CONFIG`:

| Candidate | Anonymous pull | Fit |
| --- | --- | --- |
| `chrislusf/seaweedfs:4.48` (`server -s3`) | yes | passes all 10 contract tests, including 403 on a length mismatch and 206 ranges |
| `quay.io/minio/minio`, `minio/minio` | no | rejected |
| `adobe/s3mock`, `localstack/localstack` (community) | manifest readable | not pulled: they do not verify signatures, so the 403 assertions could not pass |
| `dxflrs/garage`, `rustfs/rustfs` | manifest readable | not evaluated; Garage needs a cluster layout step before it serves |

Chosen: `chrislusf/seaweedfs:4.48@sha256:4e61d15fd35994cb1e43e1e553dff106794841fd9a99ade2fc8c8bfce4d7872d`, overridable with `TEST_S3_IMAGE`. Every contract assertion stays unconditional: the gateway enforces the signed length, and so does Supabase Storage, the production target. If a future image cannot enforce it, that assertion may become conditional only while Supabase keeps enforcing it, and the reason must be written here.

### Web client

- **P18. Two web ports, no picker port.** `ImageProcessor` (canvas: decode with the camera orientation, at most 1600 px on the long side, JPEG at 0.8 and again at 0.6 if above 3 MiB; the re-encode drops EXIF and GPS) and `PhotoUploader` (the signed PUT with the signed headers only; `Authorization` and cookies are never sent to the storage origin, and a test pins it). The picker is a plain `<input type="file">` with no `capture`, so the phone offers camera and library. HEIC works where the browser decodes it (iOS Safari); elsewhere the image is "unusable".
- **P19. The upload starts on pick.** Prepare, reserve for the prepared size, PUT; the entry later names the photo by id. Saving waits while a photo is preparing or uploading and never needs one (a failed upload keeps the note and the save). A photo the server turns down at save time (`PhotoUploadExpired`, `PhotoNotUploaded`, `PhotoNotFound`, `PhotoNotAvailable`, `InvalidPhoto`) returns the field to "Reintentar", which reserves a new slot and resends the prepared bytes. Photos are offline-disabled and disabled on a missed entry.
- **P20. Signed links expire.** A peer's photo is `{url, expiresAt}` valid for 10 minutes. `CACHE_VERSION` is 9 and a restored Today may hold expired links: `EvidencePhoto` does not request an expired link, shows "Foto no disponible" and asks its screen for one refetch; a failed image load does the same.
- **P21. Where the photo shows.** The owner sees it in the edit sheet and in the evidence sheet of their own commitment's history (tap a cell with an entry; the hint reads "Toca una para ver su registro, su nota y su foto."). The peer read path (visible commitments only, `{url, expiresAt}`) is built and tested, but no screen opens a peer's commitment detail today: a member's season screen is a summary. The peer surface arrives with the social feed (A3), which consumes this read path unchanged.

## Alternatives considered

### Supabase native signed upload URLs

- **Pros:** No hand-rolled signer.
- **Cons:** Creating them needs the service-role key; the size is not pinned per upload; ties the app to a Supabase API.
- **Why rejected:** The service-role rule and decoupling.

### AWS SDK for JavaScript

- **Pros:** Maintained signer.
- **Cons:** Size, Deno compatibility, a vendor dependency.
- **Why rejected:** About 150 lines of WebCrypto verified against published vectors are cheaper and portable.

### supabase-js

- **Pros:** Easy.
- **Cons:** Vendor SDK in an adapter that must be replaceable; needs the service role to sign.
- **Why rejected:** Same as native signed URLs.

### Upload through the function body

- **Pros:** One hop, no CORS.
- **Cons:** Edge request limits, CPU, cost.
- **Why rejected:** Photos never travel through the Edge Function.

### Public bucket

- **Pros:** No signing on reads.
- **Cons:** Permanent public URLs for private evidence.
- **Why rejected:** Private commitments must be owner-only.

### Server-side image processing

- **Pros:** Uniform output.
- **Cons:** CPU and dependencies on the Edge runtime.
- **Why rejected:** The client re-encodes (which strips EXIF and GPS); the server validates size, type and magic bytes.

### A scheduled job for orphans now

- **Pros:** Tidy.
- **Cons:** Job D is out of scope.
- **Why rejected:** A lazy bounded sweep plus the per-member cap bound the damage; `sweepEntryPhotos` is ready for job D.

### `If-None-Match` conditional PUT

- **Pros:** No overwrite.
- **Cons:** Supabase support is unverified.
- **Why rejected:** Not verifiable now; the residual risk is documented below.

## Consequences

### Positive

- No vendor in `packages/app` or `packages/db`; the size is pinned per upload; storage is replaceable by an adapter.
- Orphans are bounded by the cap and the sweep; a failed delete never loses a file reference.
- Fingerprints of photo-less entries do not change.

### Negative

- The S3 keys are global to Storage (no per-user scope), so the server must do all signing and the keys are a high-value secret.
- Within the 5 min TTL the owner can overwrite their own object with same-size bytes (the content type stays signed as `image/jpeg`; low impact).
- Orphans persist until a sweep runs. Two endpoints must be configured.

### Neutral

- `EntryRecord` gains `photoId`; the migration adds `entry_photos` and `entries.photo_id` with no triggers or functions (ADR-0010).

## Operational checklist (hosted, manual)

1. Create the S3 access keys in the dashboard.
2. Create the private bucket `entry-photos` with a 3 MiB limit and `image/jpeg` only (`supabase seed buckets --linked`, or by hand).
3. Set the function secrets `API_STORAGE_*`; never set the service-role key.
4. Check CORS on the hosted storage for the web origin (PUT and GET).
5. Verify presigned-host validation behind the hosted gateway (SigV4 signs `Host`).
6. Schedule `sweepEntryPhotos` when job D exists.
7. Real-device checks (not done by the tests): iPhone camera and library, HEIC, orientation, and the https tunnel path with the signing-host variables (apps/web README).

## References

- ADR-0008 (ports, addendum), ADR-0009 (time model), ADR-0010 (Postgres adapter, addendum), ADR-0011 (API layer, addendum Q24), ADR-0014, ADR-0015.
- AWS Signature Version 4 query-string authentication: https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html

## Addendum: account deletion (change `account-deletion`, ADR-0019)

"Kept when the member leaves" does not hold for account deletion: every photo of the person is deleted. Inside the transaction the entries lose their `photo_id` and the ledger rows become `released`; after commit they are purged in bounded batches (50 rows, at most 4 batches), and anything left stays `released` for the global sweep. A fully erased circle drops its ledger rows in the transaction and deletes their objects after commit; a failed object delete there can leave an unreachable orphan (no row, no URL), counted only.
