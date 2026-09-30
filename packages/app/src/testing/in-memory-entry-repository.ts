import { type CommitmentId, eq, type MemberId } from "@pactjoy/engine";
import type { EntryRepository } from "../entry/entry.repository.ts";
import type { EntryRecord } from "../entry/entry.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import type { EntryId, SeasonId } from "../shared/ids.ts";

function requestKey(entry: EntryRecord): string {
  return `${entry.memberId}|${entry.commitmentId}|${entry.clientRequestId}`;
}

/** The fields `replace` compares: what an edit can change (value, note, editedAt). */
function sameMutableState(a: EntryRecord, b: EntryRecord): boolean {
  const sameValue =
    a.value.kind === "quantity" && b.value.kind === "quantity"
      ? eq(a.value.value, b.value.value)
      : a.value.kind === b.value.kind;
  return sameValue && a.note === b.note && a.editedAt === b.editedAt;
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

    async get(id: EntryId) {
      return store.find((entry) => entry.id === id) ?? null;
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

    async replace(next: EntryRecord, previous: EntryRecord): Promise<void> {
      const index = store.findIndex((entry) => entry.id === previous.id);
      const current = store[index];
      if (!current || !sameMutableState(current, previous)) {
        throw new ConcurrencyConflict();
      }
      store[index] = next;
    },

    beginTransaction(): EntryTransactionScope {
      const staged: EntryRecord[] = [];
      // Edits by entry id; `previous` stays the state first read, `next` the latest edit.
      const replaced = new Map<EntryId, { previous: EntryRecord; next: EntryRecord }>();

      function view(): EntryRecord[] {
        return [...store.map((entry) => replaced.get(entry.id)?.next ?? entry), ...staged];
      }

      const repository: EntryRepository = {
        async findByClientRequest(memberId, commitmentId, clientRequestId) {
          return find(view(), memberId, commitmentId, clientRequestId);
        },

        async get(id: EntryId) {
          return view().find((entry) => entry.id === id) ?? null;
        },

        async listBySeason(seasonId: SeasonId) {
          return view().filter((entry) => entry.seasonId === seasonId);
        },

        async add(entry: EntryRecord): Promise<void> {
          staged.push(entry);
        },

        async replace(next: EntryRecord, previous: EntryRecord): Promise<void> {
          replaced.set(previous.id, {
            previous: replaced.get(previous.id)?.previous ?? previous,
            next,
          });
        },
      };

      return {
        repository,
        validate(): void {
          if (staged.some((entry) => conflicts(store, entry))) {
            throw new ConcurrencyConflict();
          }
          for (const { previous } of replaced.values()) {
            const current = store.find((entry) => entry.id === previous.id);
            if (!current || !sameMutableState(current, previous)) {
              throw new ConcurrencyConflict();
            }
          }
        },
        apply(): void {
          for (const [id, { next }] of replaced) {
            store[store.findIndex((entry) => entry.id === id)] = next;
          }
          store.push(...staged);
        },
      };
    },
  };
}
