import type { CommitmentId, MemberId } from "@pactjoy/engine";
import type { EntryRepository } from "../entry/entry.repository.ts";
import type { EntryCore, EntryRecord, EntryTombstone, StoredEntry } from "../entry/entry.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { EntryId, SeasonId } from "../shared/ids.ts";

function requestKey(entry: StoredEntry): string {
  return `${entry.memberId}|${entry.commitmentId}|${entry.clientRequestId}`;
}

/**
 * What an edit must never change; a real adapter's UPDATE simply does not
 * touch these columns. Exhaustive at compile time: a new `EntryRecord` field
 * fails typecheck here until it is classified as mutable (the Exclude list)
 * or listed below.
 */
const IMMUTABLE: Record<
  Exclude<keyof EntryRecord, "value" | "note" | "editedAt" | "version">,
  true
> = {
  id: true,
  seasonId: true,
  memberId: true,
  commitmentId: true,
  day: true,
  recordedOn: true,
  recordedAt: true,
  clientRequestId: true,
  requestFingerprint: true,
  deleted: true,
};
const IMMUTABLE_FIELDS = Object.keys(IMMUTABLE) as (keyof typeof IMMUTABLE)[];

/**
 * Built field by field, never by spreading the live entry: a field added to
 * `EntryCore` fails typecheck here until it is kept on purpose, and a field
 * that only lives on `EntryRecord` (evidence) can never survive a delete.
 */
function tombstone(entry: EntryRecord): EntryTombstone {
  const core: EntryCore = {
    id: entry.id,
    seasonId: entry.seasonId,
    memberId: entry.memberId,
    commitmentId: entry.commitmentId,
    day: entry.day,
    recordedOn: entry.recordedOn,
    recordedAt: entry.recordedAt,
    clientRequestId: entry.clientRequestId,
    editedAt: entry.editedAt,
    version: entry.version + 1,
    requestFingerprint: entry.requestFingerprint,
  };
  return { ...core, value: null, note: null, deleted: true };
}

/** Programming errors in the caller, not races: thrown as plain errors. */
function assertValidReplacement(current: EntryRecord, next: EntryRecord, expectedVersion: number) {
  for (const field of IMMUTABLE_FIELDS) {
    if (current[field] !== next[field]) {
      throw new Error(`EntryRepository.replace: immutable field "${field}" changed`);
    }
  }
  if (next.version !== expectedVersion + 1) {
    throw new Error("EntryRepository.replace: next.version must be expectedVersion + 1");
  }
}

/**
 * One isolated transaction's view of the repository plus its two-phase
 * commit, same `validate()`/`apply()` split as the other in-memory
 * repositories (see `in-memory-circle-repository.ts`).
 */
export interface EntryTransactionScope {
  readonly repository: EntryRepository;
  /** @throws {ConcurrencyConflict} if a staged entry's id or idempotency key now exists in the live store. Does not mutate. */
  validate(): void;
  apply(): void;
}

export interface InMemoryEntryRepository extends EntryRepository {
  beginTransaction(): EntryTransactionScope;
}

/** Deterministic in-memory {@link EntryRepository} for tests (ADR-0008). */
export function createInMemoryEntryRepository(): InMemoryEntryRepository {
  const store: StoredEntry[] = [];

  function find(
    entries: readonly StoredEntry[],
    memberId: MemberId,
    commitmentId: CommitmentId,
    clientRequestId: string,
  ): StoredEntry | null {
    return (
      entries.find(
        (entry) =>
          entry.memberId === memberId &&
          entry.commitmentId === commitmentId &&
          entry.clientRequestId === clientRequestId,
      ) ?? null
    );
  }

  /** Tombstones do not exist for `get` and `listBySeason`. */
  function visible(entries: readonly StoredEntry[]): EntryRecord[] {
    return entries.filter((entry): entry is EntryRecord => !entry.deleted);
  }

  function conflicts(entries: readonly StoredEntry[], entry: EntryRecord): boolean {
    return entries.some(
      (stored) => stored.id === entry.id || requestKey(stored) === requestKey(entry),
    );
  }

  return {
    async findByClientRequest(memberId, commitmentId, clientRequestId) {
      return find(store, memberId, commitmentId, clientRequestId);
    },

    async getStored(id: EntryId) {
      return store.find((entry) => entry.id === id) ?? null;
    },

    async get(id: EntryId) {
      return visible(store).find((entry) => entry.id === id) ?? null;
    },

    async listBySeason(seasonId: SeasonId) {
      return visible(store).filter((entry) => entry.seasonId === seasonId);
    },

    async add(entry: EntryRecord): Promise<void> {
      if (conflicts(store, entry)) {
        throw new ConcurrencyConflict();
      }
      store.push(entry);
    },

    async replace(next: EntryRecord, expectedVersion: number): Promise<void> {
      const index = store.findIndex((entry) => entry.id === next.id);
      const current = store[index];
      if (!current || current.deleted || current.version !== expectedVersion) {
        throw new ConcurrencyConflict();
      }
      assertValidReplacement(current, next, expectedVersion);
      store[index] = next;
    },

    async remove(id: EntryId, expectedVersion: number): Promise<void> {
      const index = store.findIndex((entry) => entry.id === id);
      const current = store[index];
      if (!current || current.deleted || current.version !== expectedVersion) {
        throw new ConcurrencyConflict();
      }
      store[index] = tombstone(current);
    },

    beginTransaction(): EntryTransactionScope {
      const staged: EntryRecord[] = [];
      // Edits and removals by entry id, each with the version first read.
      const replaced = new Map<EntryId, { expectedVersion: number; next: EntryRecord }>();
      const removed = new Map<EntryId, number>();

      /** Everything this transaction sees, tombstones included. */
      function viewAll(): StoredEntry[] {
        return [
          ...store.map((entry) =>
            entry.deleted
              ? entry
              : removed.has(entry.id)
                ? tombstone(replaced.get(entry.id)?.next ?? entry)
                : (replaced.get(entry.id)?.next ?? entry),
          ),
          ...staged,
        ];
      }

      function stillAt(id: EntryId, expectedVersion: number): boolean {
        const current = store.find((entry) => entry.id === id);
        return current !== undefined && !current.deleted && current.version === expectedVersion;
      }

      const repository: EntryRepository = {
        async findByClientRequest(memberId, commitmentId, clientRequestId) {
          return find(viewAll(), memberId, commitmentId, clientRequestId);
        },

        async getStored(id: EntryId) {
          return viewAll().find((entry) => entry.id === id) ?? null;
        },

        async get(id: EntryId) {
          return visible(viewAll()).find((entry) => entry.id === id) ?? null;
        },

        async listBySeason(seasonId: SeasonId) {
          return visible(viewAll()).filter((entry) => entry.seasonId === seasonId);
        },

        async add(entry: EntryRecord): Promise<void> {
          staged.push(entry);
        },

        async replace(next: EntryRecord, expectedVersion: number): Promise<void> {
          if (removed.has(next.id)) {
            throw new Error(
              "EntryRepository.replace: entry already removed in this transaction (replace after remove)",
            );
          }
          const current = visible(viewAll()).find((entry) => entry.id === next.id);
          if (current) {
            assertValidReplacement(current, next, expectedVersion);
          }
          const first = replaced.get(next.id)?.expectedVersion ?? expectedVersion;
          replaced.set(next.id, { expectedVersion: first, next });
        },

        async remove(id: EntryId, expectedVersion: number): Promise<void> {
          // A staged replace already moved the entry on, as the UPDATE does on
          // Postgres; anything else is still checked in validate() against the
          // version first read from the store.
          const staged = replaced.get(id);
          if (staged && staged.next.version !== expectedVersion) {
            throw new ConcurrencyConflict();
          }
          removed.set(id, staged?.expectedVersion ?? expectedVersion);
        },
      };

      return {
        repository,
        validate(): void {
          if (staged.some((entry) => conflicts(store, entry))) {
            throw new ConcurrencyConflict();
          }
          const read = [
            ...[...replaced].map(([id, { expectedVersion }]) => [id, expectedVersion] as const),
            ...removed,
          ];
          if (!read.every(([id, expectedVersion]) => stillAt(id, expectedVersion))) {
            throw new ConcurrencyConflict();
          }
        },
        apply(): void {
          const indexOf = (id: EntryId): number => {
            const index = store.findIndex((entry) => entry.id === id);
            if (index === -1) {
              throw new Error(`InMemoryEntryRepository.apply: entry ${id} is not stored`);
            }
            return index;
          };
          for (const [id, { next }] of replaced) {
            store[indexOf(id)] = next;
          }
          for (const id of removed.keys()) {
            store[indexOf(id)] = tombstone(store[indexOf(id)] as EntryRecord);
          }
          store.push(...staged);
        },
      };
    },
  };
}
