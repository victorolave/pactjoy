# ADR-0020: Rate limiting of the join routes per user and per client network

- **Status:** Accepted (2026-10-18)
- **Date:** 2026-10-18
- **Deciders:** Victor Olave

## Context

ADR-0011 Q17 left one condition before real users: `POST /circles/join/preview` and `POST /circles/join` distinguish an unknown invite code from a valid one, so with no limit they are an oracle over the 31^6 (about 887 million) code space. The checklist asked for rate limiting per user and per IP, or for the risk to be accepted explicitly. Both routes sit behind the JWT guard, so every attempt has a user; the client address is only known from what the gateway forwards. The Supabase Edge Function has no shared memory between invocations, so a counter must live in Postgres, and ADR-0010 forbids SQL functions and triggers.

## Decision

Both routes share one budget of **join attempts**, counted in **fixed windows** aligned to the epoch:

| Subject | Per minute | Per hour |
| --- | --- | --- |
| User (`user:<user id>`) | 10 | 30 |
| Client network (`network:<keyed hash>`) | 30 | 100 |

- **Why these numbers.**
  - A normal join is two attempts (one preview, one join), so 10 a minute leaves room for a few mistyped or expired codes without ever stopping an honest person.
  - 30 an hour caps one account at about 3,400 years for the whole code space.
  - The network limits are three times looser because people share an address (a home, an office, a carrier NAT).
  - Lower values such as 5 a minute and 20 an hour were weighed. They add nothing against enumeration at this code-space size and make a retyping person hit the wall sooner.
- **What counts.** Every well-formed attempt counts before the use case runs: unknown, expired and successful ones alike, and refused ones too. A malformed body is answered 422 by validation first. It says nothing about any code, so it is not counted and never touches the store. The lenient preview body takes any string, so a junk code on preview is an attempt like any other.
- **The refusal.** A refused attempt is `429 TooManyJoinAttempts` with no details and a `Retry-After` in whole seconds until the furthest exceeded window ends. The code plays no part in the decision, so the refusal is byte-identical whether the code exists or not. A `retryAfterSeconds` on an app error becomes the header instead of a detail. On the web it is the form-level message "Hiciste muchos intentos seguidos. Espera unos minutos y vuelve a intentarlo." (derived copy, for the owner to approve), never shown under the code boxes and with no retry button.
- **Layers.**
  - The policy (limits, windows, subjects, the verdict) is the app use case `admitJoinAttempt` (`packages/app/src/rate-limit/`).
  - Storage is a port in the transactional bag, `RateLimitRepository` (`rateLimits`), because the counter must be in Postgres and the unit of work owns the connection. It is a repository, not a standalone service port, deliberately.
  - The API layer only extracts and keys the client network, calls the use case after validation in both join routes, and maps the 429.
  - The use case commits its counts in their own transaction before the join or preview runs, so a failed join never rolls its attempt back.
- **Storage.**
  - `pactjoy.rate_limit_counters (action, subject, window_start, window_seconds, expires_at, hits)` has its primary key on `(action, subject, window_seconds, window_start)`. RLS is on with no policies, the client roles are revoked, and there is no foreign key.
  - All of an attempt's counters are hit by ONE multi-row `insert ... select from unnest(...) on conflict ... do update set hits = hits + 1 returning ...`, with the rows in primary-key order. Concurrent attempts never lose a count and never conflict, and they lock shared counters in the same order, so they cannot deadlock.
  - Ended windows are deleted lazily by the next attempt (one indexed delete on `expires_at`). There is no job, no trigger and no SQL function.
- **The client network.**
  - It is the **first** entry of `X-Forwarded-For`. IPv4 is used as it is; IPv6 is reduced to its /64, because one host or home usually holds a whole /64; an IPv4-mapped IPv6 address is read as IPv4.
  - A missing or unparsable header means only the user limits apply, and so does any address that is not global unicast. Those are, in IPv4:
    - `0/8`, `10/8`, `100.64/10`, `127/8`, `169.254/16`, `172.16/12`;
    - `192.0.0/24`, `192.0.2/24`, `192.168/16`, `198.18/15`, `198.51.100/24`, `203.0.113/24`;
    - everything from `224/4` up.

    In IPv6, anything outside `2000::/3`. Such an address is a proxy or container in front of everyone, or a forged value, and a bucket for it would be shared by all.
  - The first entry is chosen because a later entry could be a proxy shared by many users, and limiting on it would throttle everyone together. The per-user limit is the floor and cannot be forged.
  - Whether the hosted gateway overwrites or appends a client-supplied `X-Forwarded-For` is an owner check (below), and it gates setting the key. If the gateway only appends, the first entry is attacker-controlled. An attacker could then escape the network limit, and worse, fill a chosen victim network's budget: a targeted denial of joins for everyone behind that address. Refused attempts count, so the victim stays locked out while the attack lasts. The key therefore stays unset until the check shows the gateway overwrites, or until the extraction is changed to the entry the gateway itself appends.
- **No raw address is stored or logged.**
  - The network is stored as `HMAC-SHA256(API_RATE_LIMIT_KEY, network)`, truncated to 128 bits, base64url. It is keyed so that a dump of the table cannot be reversed by hashing all 2^32 IPv4 addresses.
  - The key is the optional secret `API_RATE_LIMIT_KEY` (at least 32 characters, no whitespace). When unset, only the per-user limits apply, so the API still boots without it.
  - The pipeline exposes the network to the routes as `clientNetwork` and never logs it.
- **Account deletion (ADR-0019).**
  - Erasure deletes the user's `user:` counters (`eraseUserRateLimits`), and `rate_limit_counters.subject` is registered in `ERASURE_COVERAGE` and seeded by the sentinel.
  - A `network:` row is kept until it expires (at most an hour), because nothing ties it to the account.
  - A join request already in flight with the still-valid token when the erasure commits can write a `user:` counter again. It holds only the erased id and expires within the hour; this is accepted.

## Alternatives considered

### Accept the enumeration risk (no rate limiting)

- **Pros:** No code, no table, no secret.
- **Cons:** One account can probe codes as fast as the function scales; a valid code is a join into a stranger's circle.
- **Why rejected:** Q17 asks for limiting before real users, and the cost is small.

### A sliding-window log or token bucket

- **Pros:** Smoother; no burst at a window boundary.
- **Cons:** A log needs a row per attempt; a bucket needs a read-modify-write with a version or a lock, or a SQL function, which ADR-0010 rules out.
- **Why rejected:** The boundary burst of fixed windows is at most twice the limit, which is negligible against 31^6, and one upsert per window is the simplest atomic write.

### Count in the gateway or an external store (Upstash, Cloudflare)

- **Pros:** Rejects before the function runs.
- **Cons:** A new vendor behind no port, and new secrets and infrastructure for one route pair.
- **Why rejected:** High decoupling: the limiter stays an app port with a Postgres adapter, and a vendor adapter can replace it later.

### Count malformed bodies too (throttle before validation)

- **Pros:** Garbage traffic also spends the budget.
- **Cons:** Every 422 writes to the database, and the existing "a malformed request never reaches the store" guarantees break.
- **Why rejected:** A malformed body tells nothing about codes, so counting it adds no enumeration protection.

## Consequences

### Positive

- Enumerating the code space with one account would take millennia (887M codes at 30 an hour is about 3,400 years). The real bound is the number of accounts times 30 an hour, which the per-network limit slows further.
- The limiter is a port with a contract suite run in memory and on Postgres, so swapping the store is an adapter.

### Negative

- Two extra statements per join attempt, a sweep and one upsert, in their own transaction.
- People behind one NAT share the network budget: 30 attempts a minute is generous for a join, but a large event on one Wi-Fi could hit it.
- The network limit is only as good as the gateway's `X-Forwarded-For` (see the owner check).
- Refused attempts count in every window, the hour included. Someone who keeps trying through a refused minute can therefore be locked out for up to an hour, not a minute. `Retry-After` says so, but the web copy ("Espera unos minutos") does not read it. This is accepted: a person rarely retries 20 times in a minute, and counting only admitted attempts in the long window would need a second write per attempt. The owner may want the copy to say "un rato" instead.

### Neutral

- The limits are code constants (`JOIN_ATTEMPT_LIMITS`), not configuration.

## Operational checklist (owner)

- Add the NAME `API_RATE_LIMIT_KEY` (no value) to `supabase/functions/.env.example`, which the tooling may not edit. Set a random value of 32+ characters as a function secret in the hosted project ONLY after the header check below passes. Until then the per-user limits run alone. Rotating the key only resets the network counters.
- Hosted check of the forwarded header (blocking for the key): send a request with `X-Forwarded-For: 203.0.113.7` and confirm whether the function sees the real client first (the gateway overwrote or prepended it) or the forged value. Use a temporary log of `clientNetwork !== null` and the first entry's position, never the address in a committed log. Record the answer here.

## References

- [ADR-0010](0010-postgres-adapter.md): no SQL functions or triggers.
- [ADR-0011](0011-api-layer.md): Q17 and its operational checklist.
- [ADR-0017](0017-scheduled-jobs-and-web-push.md): job routes, not needed here because the sweep is lazy.
- [ADR-0019](0019-account-deletion.md): the erasure coverage guard.
