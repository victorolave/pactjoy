import type { NotificationOutboxRepository } from "../notifications/notification-outbox.repository.ts";
import type { OutboxNotice } from "../notifications/outbox-notice.ts";

type Store = ReadonlyMap<string, OutboxNotice>;

const FINAL = new Set(["sent", "dropped", "failed"]);

/** Oldest `notBefore` first, ties by key: the order `claimDue` promises. */
const byDue = (a: OutboxNotice, b: OutboxNotice) =>
  a.notBefore - b.notBefore || (a.dedupeKey < b.dedupeKey ? -1 : 1);

interface Sink {
  /** Adds the row only if its key is still free when the transaction applies (ON CONFLICT DO NOTHING). */
  insert(row: OutboxNotice): void;
  put(row: OutboxNotice): void;
  drop(key: string): void;
}

function operations(view: () => Store, sink: Sink): NotificationOutboxRepository {
  const fenced = (key: string, claimedAttempts: number) => {
    const row = view().get(key);
    return row && row.state === "sending" && row.attempts === claimedAttempts ? row : null;
  };

  return {
    async enqueue(notices) {
      const seen = new Set(view().keys());
      let added = 0;
      for (const notice of notices) {
        if (seen.has(notice.dedupeKey)) continue;
        seen.add(notice.dedupeKey);
        sink.insert({
          ...notice,
          state: "pending",
          attempts: 0,
          leaseUntil: null,
          outcome: null,
          finishedAt: null,
        });
        added += 1;
      }
      return added;
    },

    async claimDue(now, leaseUntil, limit) {
      const due = [...view().values()]
        .filter(
          (row) =>
            (row.state === "pending" && row.notBefore <= now) ||
            (row.state === "sending" && row.leaseUntil !== null && row.leaseUntil <= now),
        )
        .sort(byDue)
        .slice(0, limit);
      return due.map((row) => {
        const claimed: OutboxNotice = {
          ...row,
          state: "sending",
          attempts: row.attempts + 1,
          leaseUntil,
        };
        sink.put(claimed);
        return claimed;
      });
    },

    async reschedule(key, claimedAttempts, next) {
      const row = fenced(key, claimedAttempts);
      if (!row) return false;
      sink.put({ ...row, ...next, state: "pending", leaseUntil: null });
      return true;
    },

    async finish(key, claimedAttempts, state, outcome, at) {
      const row = fenced(key, claimedAttempts);
      if (!row) return false;
      sink.put({ ...row, state, outcome, finishedAt: at, leaseUntil: null });
      return true;
    },

    async purgeFinished(finishedBefore, limit) {
      const old = [...view().values()]
        .filter(
          (row) =>
            FINAL.has(row.state) && row.finishedAt !== null && row.finishedAt < finishedBefore,
        )
        .slice(0, limit);
      for (const row of old) sink.drop(row.dedupeKey);
      return old.length;
    },
  };
}

export interface NotificationOutboxTransactionScope {
  readonly repository: NotificationOutboxRepository;
  /** The outbox never conflicts: inserts skip taken keys, and updates are fenced when they run. */
  validate(): void;
  apply(): void;
}

export interface InMemoryNotificationOutbox extends NotificationOutboxRepository {
  beginTransaction(): NotificationOutboxTransactionScope;
  /** Every row, oldest `notBefore` first: for assertions, not part of the port. */
  all(): readonly OutboxNotice[];
}

/**
 * Deterministic in-memory {@link NotificationOutboxRepository} for tests (ADR-0017). A
 * transaction's writes stay staged until it commits, so a rolled-back use case leaves no notice.
 */
export function createInMemoryNotificationOutbox(): InMemoryNotificationOutbox {
  const store = new Map<string, OutboxNotice>();

  const live = operations(() => store, {
    insert: (row) => {
      if (!store.has(row.dedupeKey)) store.set(row.dedupeKey, row);
    },
    put: (row) => void store.set(row.dedupeKey, row),
    drop: (key) => void store.delete(key),
  });

  return {
    ...live,

    all() {
      return [...store.values()].sort(byDue);
    },

    beginTransaction(): NotificationOutboxTransactionScope {
      const inserts = new Map<string, OutboxNotice>();
      const puts = new Map<string, OutboxNotice>();
      const drops = new Set<string>();

      function view(): Store {
        const merged = new Map(store);
        for (const [key, row] of inserts) if (!merged.has(key)) merged.set(key, row);
        for (const [key, row] of puts) merged.set(key, row);
        for (const key of drops) merged.delete(key);
        return merged;
      }

      return {
        repository: operations(view, {
          insert: (row) => void inserts.set(row.dedupeKey, row),
          put: (row) => void puts.set(row.dedupeKey, row),
          drop: (key) => {
            inserts.delete(key);
            puts.delete(key);
            drops.add(key);
          },
        }),
        validate(): void {},
        apply(): void {
          for (const [key, row] of inserts) if (!store.has(key)) store.set(key, row);
          for (const [key, row] of puts) store.set(key, row);
          for (const key of drops) store.delete(key);
        },
      };
    },
  };
}
