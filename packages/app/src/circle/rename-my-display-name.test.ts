import { describe, expect, it } from "vitest";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircleInput, joinCircleInput } from "../testing/circle-inputs.ts";
import {
  givenArchivedCircle,
  givenOpenPactWithOneApproval,
  storedSeason,
} from "../testing/pact-fixtures.ts";
import { instant } from "../time/instant.ts";
import type { Circle } from "./circle.ts";
import { createCircle } from "./create-circle.ts";
import { generateInvite } from "./generate-invite.ts";
import { joinCircle } from "./join-circle.ts";
import { leaveCircle } from "./leave-circle.ts";
import { renameMyDisplayName } from "./rename-my-display-name.ts";

const NOW = instant(1_759_060_800_000); // 2025-09-28T12:00:00.000Z
const actorFor = (id: string) => ({ userId: userId(id) });

/** Ana (creator) and Bea (joiner) share a circle. */
async function givenAnaAndBea() {
  const app = createTestApp();
  const created = await createCircle(app, actorFor("user-ana"), createCircleInput("Crew", "Ana"));
  if (!created.ok) throw new Error("fixture setup failed");
  const invite = await generateInvite(app, actorFor("user-ana"), { circleId: created.value.id });
  if (!invite.ok) throw new Error("fixture setup failed");
  const joined = await joinCircle(
    app,
    actorFor("user-bea"),
    joinCircleInput(invite.value.code, "Bea"),
  );
  if (!joined.ok) throw new Error("fixture setup failed");
  return { app, circleId: created.value.id };
}

function nameOf(circle: Circle | null | undefined, user: string) {
  return circle?.members.find((m) => m.userId === userId(user))?.displayName;
}

describe("renameMyDisplayName", () => {
  it("DN-S1 / CM-R17: renames the caller's own name, trimmed, and bumps the circle version", async () => {
    const { app, circleId } = await givenAnaAndBea();
    const before = await app.circles.get(circleId);

    const result = await renameMyDisplayName(app, actorFor("user-ana"), {
      circleId,
      displayName: "  Anita ",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(nameOf(result.value, "user-ana")).toBe("Anita");
    expect(nameOf(result.value, "user-bea")).toBe("Bea");
    expect(result.value.version).toBe((before?.version ?? 0) + 1);
    expect(nameOf(await app.circles.get(circleId), "user-ana")).toBe("Anita");
  });

  it("CM-20: a case-only change of one's own name succeeds (self excluded)", async () => {
    const { app, circleId } = await givenAnaAndBea();

    const result = await renameMyDisplayName(app, actorFor("user-ana"), {
      circleId,
      displayName: "ANA",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(nameOf(result.value, "user-ana")).toBe("ANA");
  });

  it("CM-24: the exact same name succeeds with no error", async () => {
    const { app, circleId } = await givenAnaAndBea();

    const result = await renameMyDisplayName(app, actorFor("user-ana"), {
      circleId,
      displayName: "Ana",
    });

    expect(result.ok).toBe(true);
  });

  it("CM-21: another active member's name (any case) is DisplayNameTaken and changes nothing", async () => {
    const { app, circleId } = await givenAnaAndBea();
    const before = await app.circles.get(circleId);

    const result = await renameMyDisplayName(app, actorFor("user-ana"), {
      circleId,
      displayName: " bEA ",
    });

    expect(result).toEqual({ ok: false, error: { kind: "DisplayNameTaken" } });
    expect(await app.circles.get(circleId)).toEqual(before);
  });

  it("CM-21: the name of a member who left is free", async () => {
    const { app, circleId } = await givenAnaAndBea();
    await leaveCircle(app, actorFor("user-bea"), { circleId });

    const result = await renameMyDisplayName(app, actorFor("user-ana"), {
      circleId,
      displayName: "Bea",
    });

    expect(result.ok).toBe(true);
  });

  it.each([
    ["blank", "   "],
    ["31 code points", "a".repeat(31)],
    ["NUL", "A\u0000na"],
    ["lone surrogate", "An\ud800a"],
  ])("DN-S1 / DN-S2: a %s name is InvalidDisplayName", async (_label, displayName) => {
    const { app, circleId } = await givenAnaAndBea();

    const result = await renameMyDisplayName(app, actorFor("user-ana"), { circleId, displayName });

    expect(result).toEqual({ ok: false, error: { kind: "InvalidDisplayName" } });
  });

  it("CM-22: a non-member is NotAMember, even with an invalid name (state before input)", async () => {
    const { app, circleId } = await givenAnaAndBea();
    const result = await renameMyDisplayName(app, actorFor("user-zed"), {
      circleId,
      displayName: "  ",
    });
    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("CM-22: a member who left is NotAMember", async () => {
    const { app, circleId } = await givenAnaAndBea();
    await leaveCircle(app, actorFor("user-bea"), { circleId });
    const result = await renameMyDisplayName(app, actorFor("user-bea"), {
      circleId,
      displayName: "Bea 2",
    });
    expect(result).toEqual({ ok: false, error: { kind: "NotAMember" } });
  });

  it("CM-22: an unknown circle is CircleNotFound", async () => {
    const { app, circleId } = await givenAnaAndBea();
    const result = await renameMyDisplayName(app, actorFor("user-ana"), {
      circleId: `${circleId}-nope` as typeof circleId,
      displayName: "Ana",
    });
    expect(result).toEqual({ ok: false, error: { kind: "CircleNotFound" } });
  });

  it("CM-22: an archived circle is CircleArchived, before membership is checked", async () => {
    const app = createTestApp();
    const { circle } = await givenArchivedCircle(app);
    const result = await renameMyDisplayName(app, actorFor("user-zed"), {
      circleId: circle.id,
      displayName: "Anyone",
    });
    expect(result).toEqual({ ok: false, error: { kind: "CircleArchived" } });
  });

  it("CM-23: with an open pact and an approval, approvals and pactRevision are unchanged", async () => {
    const app = createTestApp({ now: NOW });
    const { circle, season, andrea } = await givenOpenPactWithOneApproval(app);
    expect(season.approvals).toHaveLength(1);
    const circleBefore = await app.circles.get(circle.id);

    const result = await renameMyDisplayName(app, andrea, {
      circleId: circle.id,
      displayName: "Andrea Renamed",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.version).toBe((circleBefore?.version ?? 0) + 1);
    const after = await storedSeason(app, season.id);
    expect(after.approvals).toEqual(season.approvals);
    expect(after.pactRevision).toBe(season.pactRevision);
    expect(after.version).toBe(season.version);
  });
});
