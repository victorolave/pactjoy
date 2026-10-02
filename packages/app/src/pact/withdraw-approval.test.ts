import { describe, expect, it } from "vitest";
import { createCircle } from "../circle/create-circle.ts";
import { generateInvite } from "../circle/generate-invite.ts";
import { joinCircle } from "../circle/join-circle.ts";
import { addCommitment } from "../commitment/add-commitment.ts";
import { createSeason } from "../season/create-season.ts";
import { habitId, seasonId, userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircleInput, joinCircleInput } from "../testing/circle-inputs.ts";
import { instant } from "../time/instant.ts";
import { approvePact } from "./approve-pact.ts";
import { withdrawApproval } from "./withdraw-approval.ts";

function actorFor(id: string) {
  return { userId: userId(id) };
}

const NOW = instant(1_759_060_800_000);

async function twoMemberSeason(app: ReturnType<typeof createTestApp>) {
  const circle = await createCircle(app, actorFor("user-andrea"), createCircleInput("Río Runners"));
  if (!circle.ok) throw new Error("fixture setup failed");
  const invite = await generateInvite(app, actorFor("user-andrea"), { circleId: circle.value.id });
  if (!invite.ok) throw new Error("fixture setup failed");
  const joined = await joinCircle(app, actorFor("user-victor"), joinCircleInput(invite.value.code));
  if (!joined.ok) throw new Error("fixture setup failed");
  const season = await createSeason(app, actorFor("user-andrea"), {
    circleId: circle.value.id,
    timezone: "America/Santiago",
    startDate: "2025-10-01",
    lengthWeeks: 8,
  });
  if (!season.ok) throw new Error("fixture setup failed");
  const withCommitment = await addCommitment(app, actorFor("user-andrea"), {
    seasonId: season.value.id,
    habitId: habitId("habit-run"),
    weightPercent: 100,
    privacy: "visible",
    measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
  });
  if (!withCommitment.ok) throw new Error("fixture setup failed");
  return { circle: circle.value, season: withCommitment.value.season };
}

describe("withdrawApproval", () => {
  it("PA-3: withdrawing while the pact is open leaves it open, unaffecting other members", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await twoMemberSeason(app);
    const approved = await approvePact(app, actorFor("user-andrea"), {
      seasonId: season.id,
      expectedPactRevision: season.pactRevision,
    });
    if (!approved.ok) throw new Error("fixture setup failed");
    expect(approved.value.approvals).toHaveLength(1);

    const result = await withdrawApproval(app, actorFor("user-andrea"), {
      seasonId: approved.value.id,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.approvals).toHaveLength(0);
    expect(result.value.status).toBe("pactOpen");
    expect(result.value.pactRevision).toBe(season.pactRevision);
  });

  it("PA-4: withdrawing after the pact has already closed is rejected", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await twoMemberSeason(app);
    const victorCommitted = await addCommitment(app, actorFor("user-victor"), {
      seasonId: season.id,
      habitId: habitId("habit-swim"),
      weightPercent: 100,
      privacy: "visible",
      measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } },
    });
    if (!victorCommitted.ok) throw new Error("fixture setup failed");
    const firstApproval = await approvePact(app, actorFor("user-andrea"), {
      seasonId: victorCommitted.value.season.id,
      expectedPactRevision: victorCommitted.value.season.pactRevision,
    });
    if (!firstApproval.ok) throw new Error("fixture setup failed");
    const closed = await approvePact(app, actorFor("user-victor"), {
      seasonId: firstApproval.value.id,
      expectedPactRevision: firstApproval.value.pactRevision,
    });
    if (!closed.ok) throw new Error("fixture setup failed");
    expect(closed.value.status).toBe("active");

    const result = await withdrawApproval(app, actorFor("user-andrea"), {
      seasonId: closed.value.id,
    });

    expect(result).toEqual({ ok: false, error: { kind: "PactAlreadyClosed" } });
  });

  it("rejects a non-member", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await twoMemberSeason(app);

    const result = await withdrawApproval(app, actorFor("user-outsider"), {
      seasonId: season.id,
    });

    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("rejects when the season does not exist", async () => {
    const app = createTestApp({ now: NOW });

    const result = await withdrawApproval(app, actorFor("user-andrea"), {
      seasonId: seasonId("season-ghost"),
    });

    expect(result).toEqual({ ok: false, error: { kind: "SeasonNotFound" } });
  });

  it("withdrawing without a recorded approval is a harmless no-op", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await twoMemberSeason(app);

    const result = await withdrawApproval(app, actorFor("user-andrea"), { seasonId: season.id });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual(season);
    const stored = await app.uow.read((repos) => repos.seasons.get(season.id));
    expect(stored).toEqual(season);
    expect(stored?.version).toBe(season.version);
  });

  it("withdrawing twice: the second call is an idempotent no-op that does not bump the version", async () => {
    const app = createTestApp({ now: NOW });
    const { season } = await twoMemberSeason(app);
    const approved = await approvePact(app, actorFor("user-andrea"), {
      seasonId: season.id,
      expectedPactRevision: season.pactRevision,
    });
    if (!approved.ok) throw new Error("fixture setup failed");
    const first = await withdrawApproval(app, actorFor("user-andrea"), { seasonId: season.id });
    if (!first.ok) throw new Error("fixture setup failed");

    const second = await withdrawApproval(app, actorFor("user-andrea"), { seasonId: season.id });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.value.version).toBe(first.value.version);
    expect((await app.uow.read((repos) => repos.seasons.get(season.id)))?.version).toBe(
      first.value.version,
    );
  });
});
