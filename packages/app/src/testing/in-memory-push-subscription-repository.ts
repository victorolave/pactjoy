import type {
  PushSubscriptionRecord,
  PushSubscriptionRepository,
} from "../notifications/push-subscription.repository.ts";
import type { PushSubscriptionId } from "../shared/ids.ts";

type Store = ReadonlyMap<PushSubscriptionId, PushSubscriptionRecord>;

/** Most recently seen first, ties by id: the order `listByUser` promises. */
const byRecency = (a: PushSubscriptionRecord, b: PushSubscriptionRecord) =>
  b.lastSeenAt - a.lastSeenAt || (a.id < b.id ? -1 : 1);

interface Sink {
  put(record: PushSubscriptionRecord): void;
  drop(id: PushSubscriptionId): void;
}

function operations(view: () => Store, sink: Sink): PushSubscriptionRepository {
  const listByUser = async (userId: PushSubscriptionRecord["userId"]) =>
    [...view().values()].filter((record) => record.userId === userId).sort(byRecency);

  return {
    async upsert(record) {
      const existing = [...view().values()].find((other) => other.endpoint === record.endpoint);
      sink.put(
        existing
          ? {
              ...existing,
              userId: record.userId,
              p256dh: record.p256dh,
              auth: record.auth,
              lastSeenAt: record.lastSeenAt,
            }
          : record,
      );
    },

    async remove(userId, endpoint) {
      for (const record of view().values()) {
        if (record.userId === userId && record.endpoint === endpoint) sink.drop(record.id);
      }
    },

    async removeById(id) {
      if (view().has(id)) sink.drop(id);
    },

    async removeAllOfUser(userId) {
      for (const record of view().values()) {
        if (record.userId === userId) sink.drop(record.id);
      }
    },

    listByUser,

    async trimOldest(userId, keep) {
      for (const record of (await listByUser(userId)).slice(keep)) sink.drop(record.id);
    },
  };
}

export interface PushSubscriptionTransactionScope {
  readonly repository: PushSubscriptionRepository;
  /** Subscriptions never conflict: an upsert by endpoint is last-writer-wins, as on Postgres. */
  validate(): void;
  apply(): void;
}

export interface InMemoryPushSubscriptionRepository extends PushSubscriptionRepository {
  beginTransaction(): PushSubscriptionTransactionScope;
  /** Every stored device: for assertions, not part of the port. */
  all(): readonly PushSubscriptionRecord[];
}

/** Deterministic in-memory {@link PushSubscriptionRepository} for tests (ADR-0017). */
export function createInMemoryPushSubscriptionRepository(): InMemoryPushSubscriptionRepository {
  const store = new Map<PushSubscriptionId, PushSubscriptionRecord>();

  const live = operations(() => store, {
    put: (record) => void store.set(record.id, record),
    drop: (id) => void store.delete(id),
  });

  return {
    ...live,

    all() {
      return [...store.values()].sort(byRecency);
    },

    beginTransaction(): PushSubscriptionTransactionScope {
      const puts = new Map<PushSubscriptionId, PushSubscriptionRecord>();
      const drops = new Set<PushSubscriptionId>();

      function view(): Store {
        const merged = new Map(store);
        for (const [id, record] of puts) merged.set(id, record);
        for (const id of drops) merged.delete(id);
        return merged;
      }

      return {
        repository: operations(view, {
          put: (record) => {
            drops.delete(record.id);
            puts.set(record.id, record);
          },
          drop: (id) => {
            puts.delete(id);
            drops.add(id);
          },
        }),
        validate(): void {},
        apply(): void {
          for (const [id, record] of puts) store.set(id, record);
          for (const id of drops) store.delete(id);
        },
      };
    },
  };
}
