import {
  buildCommitment,
  ConcurrencyConflict,
  cancelPauseRequest,
  circleId,
  commitmentId,
  createIntlTimeZone,
  createUuidV7IdGenerator,
  habitId,
  instant,
  localDate,
  memberId,
  ok,
  type PauseRequestRecord,
  type Repositories,
  recordEntry,
  requestPause,
  respondToPause,
  type Season,
  seasonId,
  timeZoneId,
  userId,
} from "@pactjoy/app";
import { afterAll, describe, expect, it } from "vitest";
import { noEvidenceStorage } from "../scripts/dev-seed/no-evidence-storage.ts";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
/** 2026-10-06T15:00:00Z: noon in Bogota on season day 5 (day 0 is 2026-10-01). */
const NOW = instant(Date.UTC(2026, 9, 6, 15));
const clock = { now: () => NOW };
const timeZone = createIntlTimeZone();
const ids = createUuidV7IdGenerator({ clock });

const REQUESTER = { id: memberId(uuid(0xa1)), user: { userId: userId(uuid(0xb1)) } };
const VICTOR = { id: memberId(uuid(0xa2)), user: { userId: userId(uuid(0xb2)) } };
const SOFIA = { id: memberId(uuid(0xa3)), user: { userId: userId(uuid(0xb3)) } };
const COMMITMENT = commitmentId(uuid(0xc01));

const member = (who: typeof REQUESTER, name: string) => ({
  id: who.id,
  userId: who.user.userId,
  displayName: name,
  status: "active" as const,
  joinedAt: NOW,
  leftAt: null,
  erasedAt: null,
});
const CIRCLE = {
  id: circleId(uuid(0xc1)),
  name: "C",
  members: [member(REQUESTER, "Andrea"), member(VICTOR, "Victor"), member(SOFIA, "Sofia")],
  invite: null,
  createdAt: NOW,
  archivedAt: null,
  version: 0,
};
const SEASON: Season = {
  id: seasonId(uuid(0xe1)),
  circleId: CIRCLE.id,
  timeZone: timeZoneId("America/Bogota"),
  nominalStart: localDate("2026-10-01"),
  actualStart: localDate("2026-10-01"),
  lengthWeeks: 8,
  reviewCadenceWeeks: 2,
  status: "active",
  commitments: [
    buildCommitment({
      id: COMMITMENT,
      memberId: REQUESTER.id,
      habitId: habitId(uuid(0xd1)),
      weightPercent: 100,
      privacy: "visible",
      measure: {
        unit: "done",
        schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
      },
    }),
  ],
  approvals: [],
  pactClosedAt: null,
  pactRevision: 0,
  createdAt: NOW,
  version: 0,
};

// Pool >= 2: every case runs two transactions at once.
const client = createClient({ url: databaseUrl(), max: 6 });
const admin = connect(databaseUrl());
const uow = createUnitOfWork(client.begin, bindRepositories);
const deps = { uow, clock, timeZone, ids, evidence: noEvidenceStorage };
afterAll(async () => {
  await truncateAll(admin);
  await client.end();
  await admin.end();
});

/** Bounded repetitions: overlap is timing-dependent, the invariants are not. */
const ITERATIONS = 15;

async function given(extra?: (repos: Repositories) => Promise<void>) {
  await truncateAll(admin);
  await uow.transaction(async (repos) => {
    await repos.circles.save(CIRCLE, null);
    await repos.seasons.save(SEASON, null);
    await extra?.(repos);
    return ok(undefined);
  });
}

const ask = (extra: { startDate?: string } = {}) =>
  requestPause(deps, REQUESTER.user, {
    seasonId: SEASON.id,
    scope: { kind: "commitment", commitmentId: COMMITMENT },
    reason: "health",
    note: null,
    startDate: localDate(extra.startDate ?? "2026-10-06"),
    endDate: null,
  });

const pending = (n: number): PauseRequestRecord => ({
  id: ids.next() as PauseRequestRecord["id"],
  seasonId: SEASON.id,
  memberId: REQUESTER.id,
  reason: "work",
  note: null,
  requestedAt: NOW,
  requestedOn: 5 as PauseRequestRecord["requestedOn"],
  startDay: (5 + n) as PauseRequestRecord["startDay"],
  end: { kind: "fixed", lastDay: (5 + n) as PauseRequestRecord["startDay"] },
  autoApproveAt: instant(NOW + 48 * 3_600_000),
  status: "pending",
  decidedAt: null,
  decidedOn: null,
  commitments: [{ commitmentId: COMMITMENT, resumedOn: null, resumedAt: null }],
  responses: [],
  version: 0,
});

describe("pause writes on Postgres: concurrency (ADR-0013, D9)", () => {
  it("PC-S1: two concurrent requests on one Commitment give exactly one PauseOverlaps", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      await given();

      const race = await Promise.all([ask(), ask()]);

      expect(race.filter((r) => r.ok)).toHaveLength(1);
      expect(race.find((r) => !r.ok)).toEqual({
        ok: false,
        error: { kind: "PauseOverlaps", commitmentIds: [COMMITMENT] },
      });
      const [row] = await admin`select count(*)::int as n from pactjoy.pause_requests`;
      expect(row?.n).toBe(1);
    }
  });

  it("PC-S2: concurrent requests on different days both land, never a 500", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      await given();

      const race = await Promise.all([
        requestPause(deps, REQUESTER.user, {
          seasonId: SEASON.id,
          scope: { kind: "commitment", commitmentId: COMMITMENT },
          reason: "work",
          note: null,
          startDate: localDate("2026-10-08"),
          endDate: localDate("2026-10-09"),
        }),
        requestPause(deps, REQUESTER.user, {
          seasonId: SEASON.id,
          scope: { kind: "commitment", commitmentId: COMMITMENT },
          reason: "work",
          note: null,
          startDate: localDate("2026-10-12"),
          endDate: localDate("2026-10-13"),
        }),
      ]);

      expect(race.every((r) => r.ok)).toBe(true);
      const [row] = await admin`select count(*)::int as n from pactjoy.pause_requests`;
      expect(row?.n).toBe(2);
    }
  });

  it("PC-S3: two approvers answering at once lose nothing: each answer is stored or conflicts and retries", async () => {
    let sawConflict = false;
    for (let i = 0; i < ITERATIONS; i++) {
      const request = pending(0);
      await given(async ({ pauses }) => pauses.save(request, null));
      const answer = (who: typeof VICTOR) =>
        respondToPause(deps, who.user, { pauseRequestId: request.id, decision: "approve" });

      const race = await Promise.allSettled([answer(VICTOR), answer(SOFIA)]);

      for (const outcome of race) {
        if (outcome.status === "rejected") {
          sawConflict = true;
          expect(outcome.reason).toBeInstanceOf(ConcurrencyConflict);
        }
      }
      // A loser retries once (D2) and must now succeed or find the request decided.
      for (const [k, who] of [VICTOR, SOFIA].entries()) {
        if (race[k]?.status === "rejected") {
          const retry = await answer(who);
          expect(retry.ok || retry.error.kind === "PauseAlreadyDecided").toBe(true);
        }
      }
      const stored = await uow.read(({ pauses }) => pauses.get(request.id));
      expect(stored?.responses.map((r) => r.memberId).sort()).toEqual([SOFIA.id, VICTOR.id].sort());
      expect(stored?.status).toBe("approved");
    }
    process.stderr.write(
      `PC-S3: ConcurrencyConflict observed in ${ITERATIONS} iterations: ${sawConflict}\n`,
    );
  });

  it("PC-S4: a cancel racing a response ends in one consistent decision", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      const request = pending(0);
      await given(async ({ pauses }) => pauses.save(request, null));

      const race = await Promise.allSettled([
        cancelPauseRequest(deps, REQUESTER.user, { pauseRequestId: request.id }),
        respondToPause(deps, VICTOR.user, { pauseRequestId: request.id, decision: "approve" }),
      ]);

      for (const outcome of race) {
        if (outcome.status === "rejected") {
          expect(outcome.reason).toBeInstanceOf(ConcurrencyConflict);
        }
      }
      const stored = await uow.read(({ pauses }) => pauses.get(request.id));
      expect(["pending", "cancelled"]).toContain(stored?.status);
      if (stored?.status === "cancelled") expect(stored.decidedOn).toBe(5);
    }
  });

  it("PC-S5: an Entry racing a pause write blocks briefly but never conflicts", async () => {
    for (let i = 0; i < ITERATIONS; i++) {
      await given();

      const [pause, entry] = await Promise.all([
        ask({ startDate: "2026-10-07" }),
        recordEntry(deps, REQUESTER.user, {
          seasonId: SEASON.id,
          commitmentId: COMMITMENT,
          forDate: localDate("2026-10-05"),
          value: { kind: "done" },
          clientRequestId: `k-${i}`,
        }),
      ]);

      expect(pause.ok).toBe(true);
      expect(entry.ok).toBe(true);
    }
  });
});
