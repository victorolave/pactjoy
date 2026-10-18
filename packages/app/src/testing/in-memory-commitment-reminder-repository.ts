import type { CommitmentReminderRepository } from "../reminders/commitment-reminder.repository.ts";
import type { CommitmentReminder } from "../reminders/commitment-reminder.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";

type Store = ReadonlyMap<string, CommitmentReminder>;

const keyOf = (seasonId: string, commitmentId: string) => `${seasonId}|${commitmentId}`;

function read(view: () => Store): Omit<CommitmentReminderRepository, "save"> {
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

    async save(reminder, expectedVersion) {
      checkVersion(store, reminder, expectedVersion);
      store.set(keyOf(reminder.seasonId, reminder.commitmentId), reminder);
    },

    beginTransaction(): CommitmentReminderTransactionScope {
      const staged = new Map<
        string,
        { readonly reminder: CommitmentReminder; readonly expected: number | null }
      >();
      const view = (): Store => {
        const merged = new Map(store);
        for (const [key, { reminder }] of staged) merged.set(key, reminder);
        return merged;
      };
      return {
        repository: {
          ...read(view),
          async save(reminder, expectedVersion) {
            checkVersion(view(), reminder, expectedVersion);
            const key = keyOf(reminder.seasonId, reminder.commitmentId);
            const earlier = staged.get(key);
            staged.set(key, { reminder, expected: earlier ? earlier.expected : expectedVersion });
          },
        },
        validate(): void {
          for (const { reminder, expected } of staged.values()) {
            checkVersion(store, reminder, expected);
          }
        },
        apply(): void {
          for (const [key, { reminder }] of staged) store.set(key, reminder);
        },
      };
    },
  };
}
