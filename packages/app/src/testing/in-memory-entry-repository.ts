import type { CommitmentId, MemberId } from "@pactjoy/engine";
import type { EntryRepository } from "../entry/entry.repository.ts";
import type { EntryRecord } from "../entry/entry.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { SeasonId } from "../shared/ids.ts";

function requestKey(entry: EntryRecord): string {
  return `${entry.memberId}|${entry.commitmentId}|${entry.clientRequestId}`;
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

  function conflicts(entries: readonly EntryRecord[], entry: EntryRecord): boolean {
    return entries.some(
      (stored) => stored.id === entry.id || requestKey(stored) === requestKey(entry),
    );
  }

  return {
    async findByClientRequest(memberId, commitmentId, clientRequestId) {
      return find(store, memberId, commitmentId, clientRequestId);
    },

    async listBySeason(seasonId: SeasonId) {
      return store.filter((entry) => entry.seasonId === seasonId);
    },

    async add(entry: EntryRecord): Promise<void> {
      if (conflicts(store, entry)) {
        throw new ConcurrencyConflict();
      }
      store.push(entry);
    },

    beginTransaction(): EntryTransactionScope {
      const staged: EntryRecord[] = [];

      const repository: EntryRepository = {
        async findByClientRequest(memberId, commitmentId, clientRequestId) {
          return find([...store, ...staged], memberId, commitmentId, clientRequestId);
        },

        async listBySeason(seasonId: SeasonId) {
          return [...store, ...staged].filter((entry) => entry.seasonId === seasonId);
        },

        async add(entry: EntryRecord): Promise<void> {
          staged.push(entry);
        },
      };

      return {
        repository,
        validate(): void {
          if (staged.some((entry) => conflicts(store, entry))) {
            throw new ConcurrencyConflict();
          }
        },
        apply(): void {
          store.push(...staged);
        },
      };
    },
  };
}
