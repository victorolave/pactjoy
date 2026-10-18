import type { CommitmentReminderRepository } from "../reminders/commitment-reminder.repository.ts";
import type { CommitmentReminder } from "../reminders/commitment-reminder.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";

type Store = ReadonlyMap<string, CommitmentReminder>;

const keyOf = (seasonId: string, commitmentId: string) => `${seasonId}|${commitmentId}`;

function read(view: () => Store): Pick<CommitmentReminderRepository, "get" | "listEnabled"> {
  return {
    async get(seasonId, commitmentId) {
      return view().get(keyOf(seasonId, commitmentId)) ?? null;
    },
    async listEnabled(seasonId) {
      return [...view().values()]
        .filter((reminder) => reminder.seasonId === seasonId && reminder.enabled)
        .sort((a, b) => (a.commitmentId < b.commitmentId ? -1 : 1));
    },
  };
}

function erasures(
  view: () => Store,
  drop: (key: string) => void,
): Pick<CommitmentReminderRepository, "deleteByMembers" | "deleteBySeasons"> {
  const dropWhere = (matches: (reminder: CommitmentReminder) => boolean) => {
    for (const [key, reminder] of view()) if (matches(reminder)) drop(key);
  };
  return {
    async deleteByMembers(memberIds) {
      const members = new Set(memberIds);
      dropWhere((reminder) => members.has(reminder.memberId));
    },
    async deleteBySeasons(seasonIds) {
      const seasons = new Set(seasonIds);
      dropWhere((reminder) => seasons.has(reminder.seasonId));
    },
  };
}

function checkVersion(store: Store, reminder: CommitmentReminder, expected: number | null): void {
  const stored = store.get(keyOf(reminder.seasonId, reminder.commitmentId));
  if ((stored ? stored.version : null) !== expected) throw new ConcurrencyConflict();
}

export interface CommitmentReminderTransactionScope {
  readonly repository: CommitmentReminderRepository;
  /** @throws {ConcurrencyConflict} if a staged write no longer fits the live store. Does not mutate. */
  validate(): void;
  /** Applies every staged write. Callers MUST call `validate()` first. */
  apply(): void;
}

export interface InMemoryCommitmentReminderRepository extends CommitmentReminderRepository {
  beginTransaction(): CommitmentReminderTransactionScope;
}

/**
 * Deterministic in-memory {@link CommitmentReminderRepository} for tests (ADR-0017). Same rules as
 * the database adapter: one row per `(season, commitment)`, versioned writes.
 */
export function createInMemoryCommitmentReminderRepository(): InMemoryCommitmentReminderRepository {
  const store = new Map<string, CommitmentReminder>();

  return {
    ...read(() => store),
    ...erasures(
      () => store,
      (key) => void store.delete(key),
    ),

    async save(reminder, expectedVersion) {
      checkVersion(store, reminder, expectedVersion);
      store.set(keyOf(reminder.seasonId, reminder.commitmentId), reminder);
    },

    beginTransaction(): CommitmentReminderTransactionScope {
      const staged = new Map<
        string,
        { readonly reminder: CommitmentReminder; readonly expected: number | null }
      >();
      const drops = new Set<string>();
      const view = (): Store => {
        const merged = new Map(store);
        for (const key of drops) merged.delete(key);
        for (const [key, { reminder }] of staged) merged.set(key, reminder);
        return merged;
      };
      return {
        repository: {
          ...read(view),
          ...erasures(view, (key) => {
            staged.delete(key);
            drops.add(key);
          }),
          async save(reminder, expectedVersion) {
            checkVersion(view(), reminder, expectedVersion);
            const key = keyOf(reminder.seasonId, reminder.commitmentId);
            const earlier = staged.get(key);
            // A save after a deletion replaces the row that is still stored, so it is fenced by it.
            const expected = earlier
              ? earlier.expected
              : drops.has(key)
                ? (store.get(key)?.version ?? null)
                : expectedVersion;
            drops.delete(key);
            staged.set(key, { reminder, expected });
          },
        },
        validate(): void {
          for (const { reminder, expected } of staged.values()) {
            checkVersion(store, reminder, expected);
          }
        },
        apply(): void {
          for (const key of drops) store.delete(key);
          for (const [key, { reminder }] of staged) store.set(key, reminder);
        },
      };
    },
  };
}
