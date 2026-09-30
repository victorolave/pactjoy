import { describe, expect, it } from "vitest";
import { generateInvite } from "../circle/generate-invite.ts";
import { joinCircle } from "../circle/join-circle.ts";
import { leaveCircle } from "../circle/leave-circle.ts";
import { editCommitment } from "../commitment/edit-commitment.ts";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import {
  givenOpenPactWithOneApproval,
  givenSoloOpenPact,
  storedSeason,
} from "../testing/pact-fixtures.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { instant } from "../time/instant.ts";
import { approvePact } from "./approve-pact.ts";
import { withdrawApproval } from "./withdraw-approval.ts";

// Noon UTC keeps the local calendar date "2025-09-28" stable in America/Santiago.
const NOW = instant(1_759_060_800_000);

/** Andrea owns the first commitment in the fixture (she created the circle and added hers first). */
function andreasMemberId(season: Awaited<ReturnType<typeof storedSeason>>) {
  return season.commitments[0]?.memberId;
}

function expectConflict(result: PromiseSettledResult<unknown>) {
  expect(result.status).toBe("rejected");
  expect((result as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
}

describe("pact approval races (deterministic, D5)", () => {
  it("closing approval commits first: a join that read the open pact is rejected and the circle is untouched", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea, victor } = await givenOpenPactWithOneApproval(app);
    const invite = await generateInvite(app, andrea, { circleId: circle.id });
    if (!invite.ok) throw new Error("fixture setup failed");
    const carla = { userId: userId("user-carla") };

    const { winner, loser } = await raceTransactions(
      app,
      (a) => approvePact(a, victor, { seasonId: season.id }),
      (a) => joinCircle(a, carla, { inviteCode: invite.value.code }),
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    expect((await storedSeason(app, season.id)).status).toBe("active");
    const storedCircle = await app.uow.read((repos) => repos.circles.get(circle.id));
    expect(storedCircle?.members.some((m) => m.userId === carla.userId)).toBe(false);
  });

  it("join commits first: the pact stays open with approvals reset and the closing approval is rejected", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea, victor } = await givenOpenPactWithOneApproval(app);
    const invite = await generateInvite(app, andrea, { circleId: circle.id });
    if (!invite.ok) throw new Error("fixture setup failed");
    const carla = { userId: userId("user-carla") };

    const { winner, loser } = await raceTransactions(
      app,
      (a) => joinCircle(a, carla, { inviteCode: invite.value.code }),
      (a) => approvePact(a, victor, { seasonId: season.id }),
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    const stored = await storedSeason(app, season.id);
    expect(stored.status).toBe("pactOpen");
    expect(stored.approvals).toEqual([]);
    const storedCircle = await app.uow.read((repos) => repos.circles.get(circle.id));
    expect(storedCircle?.members.some((m) => m.userId === carla.userId)).toBe(true);
  });

  it("solo circle: a join that commits first beats the closing approval, even though no approval existed to reset", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea } = await givenSoloOpenPact(app);
    expect(season.approvals).toEqual([]);
    const invite = await generateInvite(app, andrea, { circleId: circle.id });
    if (!invite.ok) throw new Error("fixture setup failed");
    const carla = { userId: userId("user-carla") };

    const { winner, loser } = await raceTransactions(
      app,
      (a) => joinCircle(a, carla, { inviteCode: invite.value.code }),
      (a) => approvePact(a, andrea, { seasonId: season.id }),
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    const stored = await storedSeason(app, season.id);
    expect(stored.status).toBe("pactOpen");
    expect(stored.approvals).toEqual([]);
    expect(stored.version).toBe(season.version + 1);
  });

  it("leave commits first: the closing approval is rejected, approvals are reset and the leaver's commitments are gone", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea, victor } = await givenOpenPactWithOneApproval(app);

    const { winner, loser } = await raceTransactions(
      app,
      (a) => leaveCircle(a, andrea, { circleId: circle.id }),
      (a) => approvePact(a, victor, { seasonId: season.id }),
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    const stored = await storedSeason(app, season.id);
    expect(stored.status).toBe("pactOpen");
    expect(stored.approvals).toEqual([]);
    expect(stored.commitments.map((c) => c.memberId)).toEqual([season.commitments[1]?.memberId]);
  });

  it("2-member circle with zero approvals: a leave that commits first beats an approval, which must not land on the stale view", async () => {
    const app = createTestApp({ now: NOW });
    const {
      circle,
      season: approvedSeason,
      andrea,
      victor,
    } = await givenOpenPactWithOneApproval(app);
    const withdrawn = await withdrawApproval(app, andrea, { seasonId: approvedSeason.id });
    if (!withdrawn.ok) throw new Error("fixture setup failed");
    expect(withdrawn.value.approvals).toEqual([]);

    const { winner, loser } = await raceTransactions(
      app,
      (a) => leaveCircle(a, victor, { circleId: circle.id }),
      (a) => approvePact(a, andrea, { seasonId: approvedSeason.id }),
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    const stored = await storedSeason(app, approvedSeason.id);
    expect(stored.status).toBe("pactOpen");
    expect(stored.approvals).toEqual([]);
    expect(stored.version).toBe(withdrawn.value.version + 1);
  });

  it("approval commits first: a concurrent commitment edit is rejected and its change never lands", async () => {
    const app = createTestApp({ now: NOW });
    const { season, andrea, victor } = await givenOpenPactWithOneApproval(app);
    const andreasCommitment = season.commitments[0];
    if (!andreasCommitment) throw new Error("fixture setup failed");

    const { winner, loser } = await raceTransactions(
      app,
      (a) => approvePact(a, victor, { seasonId: season.id }),
      (a) =>
        editCommitment(a, andrea, {
          seasonId: season.id,
          commitmentId: andreasCommitment.id,
          weightPercent: 100,
          privacy: "private",
          measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
        }),
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    const stored = await storedSeason(app, season.id);
    expect(stored.status).toBe("active");
    expect(stored.commitments[0]?.privacy).toBe("visible");
  });

  it("commitment edit commits first: approvals are reset and the closing approval is rejected", async () => {
    const app = createTestApp({ now: NOW });
    const { season, andrea, victor } = await givenOpenPactWithOneApproval(app);
    const andreasCommitment = season.commitments[0];
    if (!andreasCommitment) throw new Error("fixture setup failed");

    const { winner, loser } = await raceTransactions(
      app,
      (a) =>
        editCommitment(a, andrea, {
          seasonId: season.id,
          commitmentId: andreasCommitment.id,
          weightPercent: 100,
          privacy: "private",
          measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
        }),
      (a) => approvePact(a, victor, { seasonId: season.id }),
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    const stored = await storedSeason(app, season.id);
    expect(stored.status).toBe("pactOpen");
    expect(stored.approvals).toEqual([]);
    expect(stored.commitments[0]?.privacy).toBe("private");
  });

  it("two members approving concurrently: the first lands, the second is rejected and leaves no trace; a retry completes the pact", async () => {
    const app = createTestApp({ now: NOW });
    const { season: approvedSeason, andrea, victor } = await givenOpenPactWithOneApproval(app);
    const withdrawn = await withdrawApproval(app, andrea, { seasonId: approvedSeason.id });
    if (!withdrawn.ok) throw new Error("fixture setup failed");

    const { winner, loser } = await raceTransactions(
      app,
      (a) => approvePact(a, andrea, { seasonId: approvedSeason.id }),
      (a) => approvePact(a, victor, { seasonId: approvedSeason.id }),
    );

    expect(winner.status).toBe("fulfilled");
    expectConflict(loser);
    const afterRace = await storedSeason(app, approvedSeason.id);
    expect(afterRace.approvals.map((a) => a.memberId)).toEqual([andreasMemberId(afterRace)]);
    expect(afterRace.status).toBe("pactOpen");

    const retry = await approvePact(app, victor, { seasonId: approvedSeason.id });
    expect(retry.ok && retry.value.status).toBe("active");
  });
});
