import type { MemberId } from "@pactjoy/engine";
import type { EntryPhotoRepository } from "../entry-photo/entry-photo.repository.ts";
import type { EntryPhoto } from "../entry-photo/entry-photo.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { EntryPhotoId } from "../shared/ids.ts";

type Store = ReadonlyMap<EntryPhotoId, EntryPhoto>;

/** What `save` must never change: a relational UPDATE simply does not touch these columns. */
const IMMUTABLE: Record<Exclude<keyof EntryPhoto, "status" | "version">, true> = {
  id: true,
  seasonId: true,
  memberId: true,
  commitmentId: true,
  objectKey: true,
  byteSize: true,
  createdAt: true,
  attachBy: true,
};
const IMMUTABLE_FIELDS = Object.keys(IMMUTABLE) as (keyof typeof IMMUTABLE)[];

/** Oldest first, ties by id: the order the sweep and the listing promise. */
const byAge = (a: EntryPhoto, b: EntryPhoto) =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function keyTaken(store: Store, photo: EntryPhoto): boolean {
  for (const other of store.values()) {
    if (other.id === photo.id || other.objectKey === photo.objectKey) return true;
  }
  return false;
}

/** The only two writes the operations below need: put a row, or drop a released one. */
interface Sink {
  put(record: EntryPhoto, expectedVersion: number | null): void;
  drop(id: EntryPhotoId, expectedVersion: number): void;
}

function operations(view: () => Store, sink: Sink): EntryPhotoRepository {
  const mine = (memberId: MemberId | null) => (photo: EntryPhoto) =>
    memberId === null || photo.memberId === memberId;

  return {
    async get(id) {
      return view().get(id) ?? null;
    },

    async getMany(ids) {
      const wanted = new Set(ids);
      return [...view().values()].filter((photo) => wanted.has(photo.id));
    },

    async add(photo) {
      if (keyTaken(view(), photo)) throw new ConcurrencyConflict();
      sink.put(photo, null);
    },

    async save(next, expectedVersion) {
      const current = view().get(next.id);
      if (!current || current.version !== expectedVersion) throw new ConcurrencyConflict();
      if (next.version !== expectedVersion + 1) {
        throw new Error("EntryPhotoRepository.save: next.version must be expectedVersion + 1");
      }
      for (const field of IMMUTABLE_FIELDS) {
        if (current[field] !== next[field]) {
          throw new Error(`EntryPhotoRepository.save: immutable field "${field}" changed`);
        }
      }
      sink.put(next, expectedVersion);
    },

    async countOpen(memberId, now) {
      return [...view().values()].filter(
        (photo) =>
          photo.memberId === memberId && photo.status === "pending" && now < photo.attachBy,
      ).length;
    },

    async releaseExpired(memberId, now, limit) {
      const due = [...view().values()]
        .filter((p) => p.status === "pending" && p.attachBy <= now && mine(memberId)(p))
        .sort(byAge)
        .slice(0, limit);
      return due.map((photo) => {
        const next: EntryPhoto = { ...photo, status: "released", version: photo.version + 1 };
        sink.put(next, photo.version);
        return next;
      });
    },

    async listReleased(memberId, limit) {
      return [...view().values()]
        .filter((p) => p.status === "released" && mine(memberId)(p))
        .sort(byAge)
        .slice(0, limit);
    },

    async purge(ids) {
      for (const id of new Set(ids)) {
        const photo = view().get(id);
        if (photo?.status === "released") sink.drop(id, photo.version);
      }
    },
  };
}

interface StagedWrite {
  readonly record: EntryPhoto;
  /** The version first read from the live store; null for a row this transaction created. */
  readonly expectedVersion: number | null;
}

/**
 * One isolated transaction's view of the repository, plus its two-phase commit: same
 * `validate()`/`apply()` split as the other in-memory repositories, so a `UnitOfWork` spanning
 * several repositories stays atomic.
 */
export interface EntryPhotoTransactionScope {
  readonly repository: EntryPhotoRepository;
  /** @throws {ConcurrencyConflict} if a staged write no longer fits the live store (version, id or key). Does not mutate. */
  validate(): void;
  /** Applies every staged write to the live store. Callers MUST call `validate()` first. */
  apply(): void;
}

export interface InMemoryEntryPhotoRepository extends EntryPhotoRepository {
  beginTransaction(): EntryPhotoTransactionScope;
  /** Every stored row, oldest first: for assertions, not part of the port. */
  all(): readonly EntryPhoto[];
}

/**
 * Deterministic in-memory {@link EntryPhotoRepository} for tests (ADR-0008). Same rules as the
 * database adapter: the id and the object key are unique, and a status change is version-checked.
 */
export function createInMemoryEntryPhotoRepository(): InMemoryEntryPhotoRepository {
  const store = new Map<EntryPhotoId, EntryPhoto>();

  const live = operations(() => store, {
    put: (record) => void store.set(record.id, record),
    drop: (id) => void store.delete(id),
  });

  return {
    ...live,

    all() {
      return [...store.values()].sort(byAge);
    },

    beginTransaction(): EntryPhotoTransactionScope {
      const staged = new Map<EntryPhotoId, StagedWrite>();
      /** Released rows this transaction purges, with the version first read. */
      const dropped = new Map<EntryPhotoId, number>();

      function view(): Store {
        const merged = new Map(store);
        for (const [id, { record }] of staged) merged.set(id, record);
        for (const id of dropped.keys()) merged.delete(id);
        return merged;
      }

      const repository = operations(view, {
        put(record, expectedVersion) {
          const earlier = staged.get(record.id);
          staged.set(record.id, {
            record,
            expectedVersion: earlier ? earlier.expectedVersion : expectedVersion,
          });
        },
        drop(id, expectedVersion) {
          const earlier = staged.get(id);
          staged.delete(id);
          // A row created in this transaction never existed for the live store.
          if (earlier?.expectedVersion === null) return;
          dropped.set(id, earlier ? (earlier.expectedVersion ?? expectedVersion) : expectedVersion);
        },
      });

      return {
        repository,
        validate(): void {
          for (const [id, { record, expectedVersion }] of staged) {
            const existing = store.get(id);
            if (expectedVersion === null) {
              if (keyTaken(store, record)) throw new ConcurrencyConflict();
            } else if (!existing || existing.version !== expectedVersion) {
              throw new ConcurrencyConflict();
            }
          }
          for (const [id, expectedVersion] of dropped) {
            const existing = store.get(id);
            // Purging a row someone else already purged is fine; one that moved on is not.
            if (existing && existing.version !== expectedVersion) throw new ConcurrencyConflict();
          }
        },
        apply(): void {
          for (const [id, { record }] of staged) store.set(id, record);
          for (const id of dropped.keys()) store.delete(id);
        },
      };
    },
  };
}
