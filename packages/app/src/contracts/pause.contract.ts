import { seasonDay } from "@pactjoy/engine";
import { describe, expect, it } from "vitest";
import { memberId } from "../circle/circle.ts";
import { commitmentId } from "../commitment/commitment.ts";
import type { PauseRequestRecord } from "../pause/pause-request.ts";
import type { Repositories } from "../ports/repositories.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { pauseRequestId } from "../shared/ids.ts";
import { ok } from "../shared/result.ts";
import { pauseRequestFixture } from "../testing/builders.ts";
import { instant } from "../time/instant.ts";
import {
  type ContractSubject,
  type GuardRepositories,
  SEASON,
  seedCircleAndSeason,
} from "./fixtures.ts";

type PauseRepositories = GuardRepositories & Pick<Repositories, "pauses">;
type Uow = ContractSubject<PauseRepositories>["uow"];

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const REQUESTER = memberId("00000000-0000-4000-8000-0000000000a1");
const APPROVER = memberId(uuid(0xa2));
const NOW = 1_791_987_120_000; // 2026-10-14T14:12:00Z
const HOUR = 3_600_000;

const record = (n: number, extra: Partial<PauseRequestRecord> = {}): PauseRequestRecord =>
  pauseRequestFixture({
    id: pauseRequestId(uuid(0xb00 + n)),
    seasonId: SEASON.id,
    memberId: REQUESTER,
    commitments: [
      { commitmentId: commitmentId(uuid(0xc00 + n)), resumedOn: null, resumedAt: null },
    ],
    requestedAt: instant(NOW + n * HOUR),
    autoApproveAt: instant(NOW + n * HOUR + 48 * HOUR),
    ...extra,
  });

/** Saves in its own transaction; a lost race surfaces as the transaction rejecting. */
const save = (uow: Uow, rec: PauseRequestRecord, expected: number | null) =>
  uow.transaction(async ({ pauses }) => {
    await pauses.save(rec, expected);
    return ok(undefined);
  });
const read = (uow: Uow, rec: PauseRequestRecord) => uow.read(({ pauses }) => pauses.get(rec.id));

/**
 * `PauseRequestRepository` contract (ADR-0013), adapter-neutral: driven only
 * through `uow.transaction` / `uow.read`. The factory must return an EMPTY store.
 */
export function describePauseRequestRepositoryContract(
  name: string,
  factory: () => Promise<ContractSubject<PauseRepositories>>,
): void {
  describe(`PauseRequestRepository contract (${name})`, () => {
    const setup = async () => {
      const { uow } = await factory();
      await seedCircleAndSeason(uow);
      return uow;
    };

    it("get returns null for an unknown id", async () => {
      const uow = await setup();
      expect(await read(uow, record(1))).toBeNull();
    });

    it("save(null) inserts and get returns the same request, children and nulls included", async () => {
      const uow = await setup();
      const full = record(1, {
        note: "Rodilla",
        end: { kind: "fixed", lastDay: seasonDay(20) },
        commitments: [
          { commitmentId: commitmentId(uuid(0xc01)), resumedOn: null, resumedAt: null },
          {
            commitmentId: commitmentId(uuid(0xc02)),
            resumedOn: seasonDay(18),
            resumedAt: instant(NOW + 5 * HOUR),
          },
        ],
        responses: [{ memberId: APPROVER, response: "approve", respondedAt: instant(NOW + HOUR) }],
      });
      await save(uow, full, null);
      expect(await read(uow, full)).toEqual(full);
    });

    it("save(null) over an existing id conflicts and leaves the stored row unchanged", async () => {
      const uow = await setup();
      const first = record(1);
      await save(uow, first, null);
      await expect(save(uow, { ...first, note: "other" }, null)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      expect(await read(uow, first)).toEqual(first);
    });

    it("save at the expected version updates the root and takes the new version", async () => {
      const uow = await setup();
      const first = record(1);
      await save(uow, first, null);
      const decided = {
        ...first,
        status: "approved" as const,
        decidedAt: instant(NOW + 2 * HOUR),
        decidedOn: seasonDay(16),
        version: 1,
      };
      await save(uow, decided, 0);
      expect(await read(uow, first)).toEqual(decided);
    });

    it("save at a stale expected version conflicts and leaves the stored row unchanged", async () => {
      const uow = await setup();
      const first = record(1);
      await save(uow, first, null);
      await save(uow, { ...first, version: 1, note: "v1" }, 0);
      await expect(save(uow, { ...first, version: 1, note: "stale" }, 0)).rejects.toBeInstanceOf(
        ConcurrencyConflict,
      );
      expect((await read(uow, first))?.note).toBe("v1");
    });

    it("children are replaced wholesale on every save", async () => {
      const uow = await setup();
      const first = record(1, {
        responses: [
          { memberId: APPROVER, response: "reject", respondedAt: instant(NOW + HOUR) },
          { memberId: memberId(uuid(0xa3)), response: "approve", respondedAt: instant(NOW + HOUR) },
        ],
      });
      await save(uow, first, null);
      const next = {
        ...first,
        version: 1,
        responses: [
          {
            memberId: APPROVER,
            response: "approve" as const,
            respondedAt: instant(NOW + 2 * HOUR),
          },
        ],
        commitments: [
          { commitmentId: commitmentId(uuid(0xc09)), resumedOn: null, resumedAt: null },
        ],
      };
      await save(uow, next, 0);
      expect(await read(uow, first)).toEqual(next);
    });

    it("listBySeason returns the season's requests in creation order", async () => {
      const uow = await setup();
      const [a, b, c] = [record(3), record(1), record(2)];
      for (const rec of [a, b, c]) await save(uow, rec, null);
      const listed = await uow.read(({ pauses }) => pauses.listBySeason(SEASON.id));
      expect(listed).toEqual([a, b, c]);
    });

    it("listDue returns only pending requests whose autoApproveAt has been reached", async () => {
      const uow = await setup();
      const due = record(1);
      const notYet = record(5);
      const decided = record(2, {
        status: "approved",
        decidedAt: instant(NOW + 3 * HOUR),
        decidedOn: seasonDay(16),
      });
      for (const rec of [due, notYet, decided]) await save(uow, rec, null);

      const at = (ms: number) => uow.read(({ pauses }) => pauses.listDue(instant(ms)));
      expect(await at(due.autoApproveAt - 1)).toEqual([]);
      expect(await at(due.autoApproveAt)).toEqual([due]);
      // The decided request is past its own deadline too, but is no longer pending.
      expect(await at(decided.autoApproveAt + HOUR)).toEqual([due]);
      expect(await at(notYet.autoApproveAt)).toEqual([due, notYet]);
    });
  });
}
