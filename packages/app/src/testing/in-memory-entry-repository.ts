import type { CommitmentId, MemberId } from "@pactjoy/engine";
import type { EntryRepository } from "../entry/entry.repository.ts";
import type { EntryRecord } from "../entry/entry.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { EntryId, SeasonId } from "../shared/ids.ts";

function requestKey(entry: EntryRecord): string {
  return `${entry.memberId}|${entry.commitmentId}|${entry.clientRequestId}`;
}

/** What an edit must never change; a real adapter's UPDATE simply does not touch these columns. */
const IMMUTABLE_FIELDS = [
  "id",
  "seasonId",
  "memberId",
  "commitmentId",
  "day",
  "recordedOn",
  "recordedAt",
  "clientRequestId",
  "deleted",
] as const satisfies readonly (keyof EntryRecord)[];

function tombstone(entry: EntryRecord): EntryRecord {
  return { ...entry, deleted: true, version: entry.version + 1 };
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
  const store: EntryRecord[] = [];

  function find(
    entries: readonly EntryRecord[],
    memberId: MemberId,
    commitmentId: CommitmentId,
    clientRequestId: string,
  ): EntryRecord | null {
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
  function visible(entries: readonly EntryRecord[]): EntryRecord[] {
    return entries.filter((entry) => !entry.deleted);
  }

  function conflicts(entries: readonly EntryRecord[], entry: EntryRecord): boolean {
    return entries.some(
      (stored) => stored.id === entry.id || requestKey(stored) === requestKey(entry),
    );
  }

  return {
    async findByClientRequest(memberId, commitmentId, clientRequestId) {
      return find(store, memberId, commitmentId, clientRequestId);
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
      function viewAll(): EntryRecord[] {
        return [
          ...store.map((entry) =>
            removed.has(entry.id) ? tombstone(entry) : (replaced.get(entry.id)?.next ?? entry),
          ),
          ...staged,
        ];
      }

      function stillAt(id: EntryId, expectedVersion: number): boolean {
        const current = store.find((entry) => entry.id === id);
        return current?.version === expectedVersion;
      }

      const repository: EntryRepository = {
        async findByClientRequest(memberId, commitmentId, clientRequestId) {
          return find(viewAll(), memberId, commitmentId, clientRequestId);
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
          const current = visible(viewAll()).find((entry) => entry.id === next.id);
          if (current) {
            assertValidReplacement(current, next, expectedVersion);
          }
          const first = replaced.get(next.id)?.expectedVersion ?? expectedVersion;
          replaced.set(next.id, { expectedVersion: first, next });
        },

        async remove(id: EntryId, expectedVersion: number): Promise<void> {
          removed.set(id, expectedVersion);
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
          for (const [id, { next }] of replaced) {
            store[store.findIndex((entry) => entry.id === id)] = next;
          }
          for (const id of removed.keys()) {
            const index = store.findIndex((entry) => entry.id === id);
            store[index] = tombstone(store[index] as EntryRecord);
          }
          store.push(...staged);
        },
      };
    },
  };
}
