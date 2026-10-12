import { seasonDay } from "@pactjoy/engine";
import type {
  MemberPauseRequest,
  PauseRequestRepository,
} from "../pause/pause-request.repository.ts";
import type { PauseRequestRecord } from "../pause/pause-request.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { type PauseRequestId, pauseRequestId, type SeasonId } from "../shared/ids.ts";
import { type Instant, instant } from "../time/instant.ts";

interface StagedWrite {
  readonly record: PauseRequestRecord;
  readonly expectedVersion: number | null;
}

/**
 * One isolated transaction's view of the repository, plus its two-phase
 * commit: same `validate()`/`apply()` split as `in-memory-season-repository.ts`
 * (see its docstring), so a `UnitOfWork` spanning several repositories stays atomic.
 */
export interface PauseRequestTransactionScope {
  readonly repository: PauseRequestRepository;
  /** @throws {ConcurrencyConflict} if any staged write's `expectedVersion` no longer matches the live store. Does not mutate. */
  validate(): void;
  /** Applies every staged write to the live store. Callers MUST call `validate()` first. */
  apply(): void;
}

export interface InMemoryPauseRequestRepository extends PauseRequestRepository {
  beginTransaction(): PauseRequestTransactionScope;
  /**
   * Test-only GIVEN setup: stores an already-decided (or pending) engine-level
   * request as a persisted record, bypassing the request use case. A pending
   * seed never reaches its deadline (`autoApproveAt` is the far future) and
   * has no responses, so only an explicit change can decide it.
   */
  seed(seasonId: SeasonId, pause: MemberPauseRequest): PauseRequestRecord;
}

/** The latest instant `Instant` accepts as a safe integer: a seeded pending request never auto-approves. */
const FAR_FUTURE: Instant = instant(Number.MAX_SAFE_INTEGER);
const EPOCH: Instant = instant(0);

function listDue(store: ReadonlyMap<PauseRequestId, PauseRequestRecord>, now: Instant) {
  return [...store.values()].filter((r) => r.status === "pending" && r.autoApproveAt <= now);
}

/** Deterministic in-memory {@link PauseRequestRepository} for tests (ADR-0008). */
export function createInMemoryPauseRequestRepository(): InMemoryPauseRequestRepository {
  const store = new Map<PauseRequestId, PauseRequestRecord>();
  let seeded = 0;

  return {
    async get(id) {
      return store.get(id) ?? null;
    },

    async listBySeason(seasonId) {
      return [...store.values()].filter((r) => r.seasonId === seasonId);
    },

    async listDue(now) {
      return listDue(store, now);
    },

    async save(record, expectedVersion) {
      const existing = store.get(record.id);
      if ((existing ? existing.version : null) !== expectedVersion) throw new ConcurrencyConflict();
      store.set(record.id, record);
    },

    seed(seasonId, pause) {
      seeded += 1;
      const decision = pause.decision;
      const decided = decision.kind !== "pending";
      const record: PauseRequestRecord = {
        id: pauseRequestId(`seeded-pause-${seeded}`),
        seasonId,
        memberId: pause.memberId,
        reason: "other",
        note: null,
        requestedAt: EPOCH,
        requestedOn: pause.requestedOn,
        startDay: pause.startDay,
        end: pause.end,
        autoApproveAt: FAR_FUTURE,
        status: decision.kind === "pending" ? "pending" : decision.kind,
        decidedAt: decided ? EPOCH : null,
        decidedOn: decision.kind === "pending" ? null : seasonDay(decision.decidedOn),
        commitments: [
          {
            commitmentId: pause.commitmentId,
            resumedOn: decision.kind === "approved" ? decision.resumedOn : null,
            resumedAt: decision.kind === "approved" && decision.resumedOn !== null ? EPOCH : null,
          },
        ],
        responses: [],
        version: 0,
      };
      store.set(record.id, record);
      return record;
    },

    beginTransaction(): PauseRequestTransactionScope {
      const staged = new Map<PauseRequestId, StagedWrite>();

      function view(): Map<PauseRequestId, PauseRequestRecord> {
        const merged = new Map(store);
        for (const [id, { record }] of staged) merged.set(id, record);
        return merged;
      }

      const repository: PauseRequestRepository = {
        async get(id) {
          return staged.get(id)?.record ?? store.get(id) ?? null;
        },
        async listBySeason(seasonId) {
          return [...view().values()].filter((r) => r.seasonId === seasonId);
        },
        async listDue(now) {
          return listDue(view(), now);
        },
        async save(record, expectedVersion) {
          const current = staged.get(record.id)?.record ?? store.get(record.id);
          if ((current ? current.version : null) !== expectedVersion) {
            throw new ConcurrencyConflict();
          }
          // Keep the version the LIVE store must still have at commit (null for a row inserted here).
          const earlier = staged.get(record.id);
          staged.set(record.id, {
            record,
            expectedVersion: earlier ? earlier.expectedVersion : expectedVersion,
          });
        },
      };

      return {
        repository,
        validate(): void {
          for (const [id, { expectedVersion }] of staged) {
            const existing = store.get(id);
            if ((existing ? existing.version : null) !== expectedVersion) {
              throw new ConcurrencyConflict();
            }
          }
        },
        apply(): void {
          for (const [id, { record }] of staged) store.set(id, record);
        },
      };
    },
  };
}
