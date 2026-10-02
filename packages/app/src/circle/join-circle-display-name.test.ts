import { describe, expect, it } from "vitest";
import { ConcurrencyConflict } from "../shared/errors.ts";
import { userId } from "../shared/ids.ts";
import { createTestApp } from "../testing/app-harness.ts";
import { createCircleInput, joinCircleInput } from "../testing/circle-inputs.ts";
import { raceTransactions } from "../testing/race-harness.ts";
import { createCircle } from "./create-circle.ts";
import { generateInvite } from "./generate-invite.ts";
import { joinCircle } from "./join-circle.ts";
import { leaveCircle } from "./leave-circle.ts";

const actorFor = (id: string) => ({ userId: userId(id) });

/** Ana (user-ana) owns a circle with an invite; returns the app, circle id and code. */
async function givenCircleOfAna() {
  const app = createTestApp();
  const created = await createCircle(app, actorFor("user-ana"), createCircleInput("Crew", "Ana"));
  if (!created.ok) throw new Error("fixture setup failed");
  const invite = await generateInvite(app, actorFor("user-ana"), { circleId: created.value.id });
  if (!invite.ok) throw new Error("fixture setup failed");
  return { app, circleId: created.value.id, code: invite.value.code };
}

describe("joinCircle display name uniqueness (DN-R3)", () => {
  it.each([
    ["another case", "ana"],
    ["padded and upper case", " ANA "],
    ["the exact same name", "Ana"],
  ])(
    "DN-S3 / CM-18: %s of an active member's name is DisplayNameTaken and changes nothing",
    async (_label, name) => {
      const { app, circleId, code } = await givenCircleOfAna();

      const result = await joinCircle(app, actorFor("user-bea"), joinCircleInput(code, name));

      expect(result).toEqual({ ok: false, error: { kind: "DisplayNameTaken" } });
      expect((await app.circles.get(circleId))?.members).toHaveLength(1);
    },
  );

  it("compares names after NFC normalization (decomposed vs precomposed accent)", async () => {
    const app = createTestApp();
    const created = await createCircle(
      app,
      actorFor("user-ana"),
      createCircleInput("Crew", "Jose\u0301"),
    );
    if (!created.ok) throw new Error("fixture setup failed");
    const invite = await generateInvite(app, actorFor("user-ana"), { circleId: created.value.id });
    if (!invite.ok) throw new Error("fixture setup failed");

    const result = await joinCircle(
      app,
      actorFor("user-bea"),
      joinCircleInput(invite.value.code, "JOS\u00c9"),
    );

    expect(result).toEqual({ ok: false, error: { kind: "DisplayNameTaken" } });
  });

  it("DN-S4: a name freed by a member who left can be taken again", async () => {
    const { app, circleId, code } = await givenCircleOfAna();
    const bea = await joinCircle(app, actorFor("user-bea"), joinCircleInput(code, "Bea"));
    if (!bea.ok) throw new Error("fixture setup failed");
    await leaveCircle(app, actorFor("user-ana"), { circleId });

    const result = await joinCircle(app, actorFor("user-cy"), joinCircleInput(code, "ana"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.members.map((m) => [m.displayName, m.status])).toEqual([
      ["Ana", "left"],
      ["Bea", "active"],
      ["ana", "active"],
    ]);
  });

  it("checks the state first: a full circle answers CircleFull, not DisplayNameTaken", async () => {
    const { app, code } = await givenCircleOfAna();
    for (const n of [1, 2, 3, 4, 5]) {
      const joined = await joinCircle(
        app,
        actorFor(`user-${n}`),
        joinCircleInput(code, `Member ${n}`),
      );
      if (!joined.ok) throw new Error("fixture setup failed");
    }

    const result = await joinCircle(app, actorFor("user-late"), joinCircleInput(code, "Ana"));

    expect(result).toEqual({ ok: false, error: { kind: "CircleFull" } });
  });

  it("DN-S5: two concurrent joins with the same name -- one succeeds, the other conflicts, one row", async () => {
    const { app, circleId, code } = await givenCircleOfAna();

    const { winner, loser } = await raceTransactions(
      app,
      (a) => joinCircle(a, actorFor("user-bea"), joinCircleInput(code, "Zed")),
      (a) => joinCircle(a, actorFor("user-cy"), joinCircleInput(code, "zed")),
    );

    expect(winner).toMatchObject({ status: "fulfilled", value: { ok: true } });
    expect(loser.status).toBe("rejected");
    expect((loser as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrencyConflict);
    expect((await app.circles.get(circleId))?.members.map((m) => m.displayName)).toEqual([
      "Ana",
      "Zed",
    ]);
  });
});
