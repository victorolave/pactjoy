import { describe, expect, it } from "vitest";
import { findActiveMember } from "../circle/circle.ts";
import { addCommitment } from "../commitment/add-commitment.ts";
import { editCommitment } from "../commitment/edit-commitment.ts";
import { removeCommitment } from "../commitment/remove-commitment.ts";
import type { Actor } from "../shared/actor.ts";
import { habitId } from "../shared/ids.ts";
import { createTestApp, type TestApp } from "../testing/app-harness.ts";
import { givenOpenPactWithOneApproval } from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";

// Noon UTC keeps the local calendar date "2025-09-28" stable in America/Santiago.
const NOW = instant(1_759_060_800_000);

const DONE = { unit: "done" as const, frequency: { kind: "timesPerWeek" as const, times: 3 } };

/** The id of the circle member behind `actor`, read from the stored circle. */
async function memberIdOf(
  app: TestApp,
  circleId: Parameters<TestApp["circles"]["get"]>[0],
  actor: Actor,
) {
  const circle = await app.circles.get(circleId);
  const member = circle ? findActiveMember(circle, actor.userId) : undefined;
  if (!member) throw new Error("fixture setup failed");
  return member.id;
}

/**
 * UE-S1..S5, UE-P1, UE-P2 (Q8): every season mutation returns the season together with the member
 * who acted, resolved inside the transaction -- no post-commit lookup (ADR-0011).
 */
describe("season mutations return { season, viewerId } (SV-R2)", () => {
  it("addCommitment returns the member who added, not another member", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, victor } = await givenOpenPactWithOneApproval(app);

    const result = await addCommitment(app, victor, {
      seasonId: season.id,
      habitId: habitId("habit-extra"),
      weightPercent: 10,
      privacy: "private",
      measure: DONE,
    });

    expect(result.ok && result.value.viewerId).toBe(await memberIdOf(app, circle.id, victor));
    expect(result.ok && result.value.season.commitments).toHaveLength(3);
  });

  it("editCommitment returns the owner, on a change and on a no-op", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, victor } = await givenOpenPactWithOneApproval(app);
    const victorId = await memberIdOf(app, circle.id, victor);
    const mine = season.commitments.find((c) => c.memberId === victorId);
    if (!mine) throw new Error("fixture setup failed");
    const same = {
      seasonId: season.id,
      commitmentId: mine.id,
      weightPercent: 100,
      privacy: "visible" as const,
      measure: DONE,
    };

    const noop = await editCommitment(app, victor, same);
    const changed = await editCommitment(app, victor, { ...same, privacy: "private" });

    expect(noop.ok && noop.value.viewerId).toBe(victorId);
    expect(changed.ok && changed.value.viewerId).toBe(victorId);
    expect(changed.ok && changed.value.season.version).toBe(season.version + 1);
  });

  it("removeCommitment returns the owner", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, victor } = await givenOpenPactWithOneApproval(app);
    const victorId = await memberIdOf(app, circle.id, victor);
    const mine = season.commitments.find((c) => c.memberId === victorId);
    if (!mine) throw new Error("fixture setup failed");

    const result = await removeCommitment(app, victor, {
      seasonId: season.id,
      commitmentId: mine.id,
    });

    expect(result.ok && result.value.viewerId).toBe(victorId);
    expect(result.ok && result.value.season.commitments).toHaveLength(1);
  });
});
