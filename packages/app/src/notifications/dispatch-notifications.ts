import type { PushOutcome, PushSender } from "../ports/push-sender.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { PushSubscriptionId } from "../shared/ids.ts";
import { ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import { type Instant, instant } from "../time/instant.ts";
import type { TimeZone } from "../time/time-zone.port.ts";
import { relevanceOf } from "./notice-relevance.ts";
import { addDays, morningWindow, quietHoursEnd } from "./notice-timing.ts";
import type { NoticeReschedule } from "./notification-outbox.repository.ts";
import type { NoticeOutcome, OutboxNotice } from "./outbox-notice.ts";

export interface DispatchNotificationsDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
  /** `null` when Web Push is not configured: the job then claims nothing and sends nothing. */
  readonly push: PushSender | null;
}

export interface DispatchNotificationsInput {
  /** At most this many notices per run (default 50), so a run fits an Edge Function's time limit. */
  readonly limit?: number;
}

/** Counts only: never an id, an endpoint or a name (REQ-J6). */
export interface DispatchNotificationsResult {
  readonly claimed: number;
  readonly sent: number;
  readonly dropped: number;
  /** Rescheduled after a temporary failure. */
  readonly retried: number;
  readonly failed: number;
  /** Moved out of quiet hours, or rolled over to the next day. */
  readonly deferred: number;
}

type Handled = "sent" | "dropped" | "retried" | "failed" | "deferred";

const MIN_MS = 60_000;
const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 50;
const LEASE_MS = 5 * MIN_MS;
/** A notice is claimed at most this many times before it fails as `exhausted`. */
export const MAX_ATTEMPTS = 5;
/** Wait after attempt n (1-based) when the push service gave no Retry-After. */
const BACKOFF_MINUTES = [1, 5, 15, 60] as const;
const RETENTION_MS = 7 * DAY_MS;
const PURGE_LIMIT = 200;
/** The encoded payload stays far below what one aes128gcm record and every push service take. */
export const MAX_PAYLOAD_BYTES = 3072;
const CONCURRENCY = 4;

/** UTF-8 length of `text`, without `TextEncoder` (not in this package's standard library). */
function utf8Length(text: string): number {
  let length = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return length;
}

/** What the service worker receives: `{v: 1, kind, params}` as JSON, ids only (REQ-K1). */
export function encodePayload(notice: OutboxNotice): string {
  const json = JSON.stringify({ v: 1, kind: notice.kind, params: notice.params });
  const bytes = utf8Length(json);
  if (bytes > MAX_PAYLOAD_BYTES) {
    throw new Error(`notification payload of ${notice.kind} is ${bytes} bytes`);
  }
  return json;
}

/** Whole seconds from `now` to `until`, at least 0. */
function secondsUntil(now: Instant, until: Instant): number {
  const ms = until - now;
  return ms <= 0 ? 0 : (ms - (ms % 1000)) / 1000;
}

/**
 * Sends what is due (ADR-0017, design J8 and J13). For each claimed notice, in this order:
 * 1. past its window: a morning notice with a rollover left moves to the next day's 09:00-22:00
 *    window, anything else is dropped as `expired`;
 * 2. inside quiet hours (22:00-08:00 season-local): back to `pending` until 08:00;
 * 3. no longer relevant, or the recipient left: dropped;
 * 4. no device: dropped (`noSubscription`); otherwise sent to every device the sender accepts.
 *
 * One row per recipient: any delivery counts as `sent`; a 404/410 deletes that device; a
 * temporary failure on every device retries after 1, 5, 15 and 60 minutes (or Retry-After), up to
 * {@link MAX_ATTEMPTS} claims, then `failed`; a refusal on every device is `failed`. Deferrals do
 * not count as attempts. Sending happens OUTSIDE any transaction (ADR-0010); recording the outcome
 * is fenced by the claim, so a dispatcher whose lease expired cannot overwrite a newer one. Finally
 * final rows older than seven days are purged.
 */
export async function dispatchNotifications(
  deps: DispatchNotificationsDeps,
  input: DispatchNotificationsInput,
): Promise<Result<DispatchNotificationsResult, never>> {
  const counts = { claimed: 0, sent: 0, dropped: 0, retried: 0, failed: 0, deferred: 0 };
  if (deps.push === null) return ok(counts);
  const push: PushSender = deps.push;
  const now = deps.clock.now();

  const write = <T>(work: (repos: Repositories) => Promise<T>) =>
    deps.uow
      .transaction(async (repos) => ok(await work(repos)))
      .then((result) => (result.ok ? result.value : (undefined as T)));

  const claimed = await write((repos) =>
    repos.notifications.claimDue(now, instant(now + LEASE_MS), input.limit ?? DEFAULT_LIMIT),
  );
  counts.claimed = claimed.length;

  async function handle(notice: OutboxNotice): Promise<Handled> {
    const fence = notice.attempts;
    const end = async (
      state: "sent" | "dropped" | "failed",
      outcome: NoticeOutcome,
      gone: readonly PushSubscriptionId[] = [],
    ): Promise<Handled> => {
      await write(async (repos) => {
        for (const id of gone) await repos.pushSubscriptions.removeById(id);
        await repos.notifications.finish(notice.dedupeKey, fence, state, outcome, now);
      });
      return state;
    };
    const later = async (next: NoticeReschedule, as: Handled): Promise<Handled> => {
      await write((repos) => repos.notifications.reschedule(notice.dedupeKey, fence, next));
      return as;
    };
    // A deferral gives the claim's attempt back.
    const giveBack = fence - 1;

    if (notice.expiresAt <= now) {
      if (notice.rolloversLeft === 0) return end("dropped", "expired");
      const day = deps.timeZone.localTimeAt(notice.expiresAt, notice.timeZone).date;
      const window = morningWindow(addDays(day, 1), notice.timeZone, deps.timeZone);
      return later({ ...window, rolloversLeft: 0, attempts: giveBack }, "deferred");
    }
    const quietUntil = quietHoursEnd(now, notice.timeZone, deps.timeZone);
    if (quietUntil !== null) {
      return later(
        {
          notBefore: quietUntil,
          expiresAt: notice.expiresAt,
          rolloversLeft: notice.rolloversLeft,
          attempts: giveBack,
        },
        "deferred",
      );
    }

    const checked = await deps.uow.read(async (repos) => ({
      relevance: await relevanceOf(repos, notice, now, deps.timeZone),
      devices: await repos.pushSubscriptions.listByUser(notice.recipientUserId),
    }));
    if (checked.relevance.kind === "drop") return end("dropped", checked.relevance.outcome);
    if (checked.devices.length === 0) return end("dropped", "noSubscription");

    const message = {
      payload: encodePayload(notice),
      ttlSeconds: secondsUntil(now, notice.expiresAt),
      urgency: "normal" as const,
      collapseKey: notice.dedupeKey,
    };
    const outcomes: { readonly id: PushSubscriptionId; readonly outcome: PushOutcome }[] = [];
    for (const device of checked.devices) {
      const outcome: PushOutcome = push.accepts(device.endpoint)
        ? await push.send(device, message, now)
        : { kind: "rejected", status: 0 };
      outcomes.push({ id: device.id, outcome });
    }
    const gone = outcomes.filter((o) => o.outcome.kind === "gone").map((o) => o.id);
    if (outcomes.some((o) => o.outcome.kind === "delivered")) return end("sent", "delivered", gone);

    const retries = outcomes.flatMap((o) => (o.outcome.kind === "retry" ? [o.outcome] : []));
    if (retries.length > 0) {
      if (notice.attempts >= MAX_ATTEMPTS) return end("failed", "exhausted", gone);
      const hinted = retries.flatMap((r) =>
        r.retryAfterSeconds === null ? [] : [r.retryAfterSeconds],
      );
      const waitMs =
        hinted.length > 0
          ? hinted.reduce((a, b) => (a > b ? a : b)) * 1000
          : (BACKOFF_MINUTES[notice.attempts - 1] ?? 60) * MIN_MS;
      await write(async (repos) => {
        for (const id of gone) await repos.pushSubscriptions.removeById(id);
        await repos.notifications.reschedule(notice.dedupeKey, fence, {
          notBefore: instant(now + waitMs),
          expiresAt: notice.expiresAt,
          rolloversLeft: notice.rolloversLeft,
          attempts: notice.attempts,
        });
      });
      return "retried";
    }
    if (outcomes.some((o) => o.outcome.kind === "rejected")) return end("failed", "rejected", gone);
    return end("dropped", "noSubscription", gone);
  }

  // A small pool: one slow push service does not hold the batch, and one bad notice never stops it
  // (REQ-O16). A notice whose handling throws keeps its lease and is claimed again once it expires.
  const queue = [...claimed];
  const worker = async () => {
    for (let notice = queue.shift(); notice !== undefined; notice = queue.shift()) {
      try {
        counts[await handle(notice)] += 1;
      } catch {
        // Left `sending`: reclaimed after the lease, and counted towards its attempts then.
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  await write((repos) =>
    repos.notifications.purgeFinished(instant(now - RETENTION_MS), PURGE_LIMIT),
  );
  return ok(counts);
}
