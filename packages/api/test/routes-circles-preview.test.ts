import { describe, expect, it } from "vitest";
import { createCircleBody, joinCircleBody } from "../src/testing/index.ts";
import { setup } from "./harness.ts";

async function givenInvitedCircle() {
  const ctx = setup();
  const created = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew", "Zoe"));
  const circleId: string = created.json.data.id;
  const invite = await ctx.call("POST", `/circles/${circleId}/invite`, "andrea");
  return { ...ctx, circleId, code: invite.json.data.code as string };
}

describe("POST /circles/join/preview (IP-R1..R4)", () => {
  it("IP-R4: 401 without a token", async () => {
    const { call } = setup();
    const res = await call("POST", "/circles/join/preview", null, { inviteCode: "AAAAAA" });
    expect(res.status).toBe(401);
  });

  it("IP-S1: 200 with exactly name, inviter, count and expiry, and no state change", async () => {
    const { call, code, app, circleId } = await givenInvitedCircle();
    const res = await call("POST", "/circles/join/preview", "victor", {
      inviteCode: ` ${code.toLowerCase()} `,
    });
    expect(res.status).toBe(200);
    expect(Object.keys(res.json.data).sort()).toEqual([
      "activeMemberCount",
      "circleName",
      "expiresAt",
      "invitedBy",
    ]);
    expect(res.json.data).toMatchObject({
      circleName: "Crew",
      invitedBy: "Zoe",
      activeMemberCount: 1,
    });
    expect(res.json.data.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
    const stored = await app.circles.get(circleId as never);
    expect(stored?.members).toHaveLength(1);
  });

  it("IP-S6: unknown and malformed codes are the same 404", async () => {
    const { call } = await givenInvitedCircle();
    const unknown = await call("POST", "/circles/join/preview", "victor", { inviteCode: "AAAAAA" });
    const malformed = await call("POST", "/circles/join/preview", "victor", { inviteCode: "x" });
    expect([unknown.status, unknown.json.error.code]).toEqual([404, "InviteNotFound"]);
    expect([malformed.status, malformed.json.error.code]).toEqual([404, "InviteNotFound"]);
    expect(malformed.json.error).toEqual(unknown.json.error);
  });

  it("IP-S3: a member of another circle gets the join's 409 AlreadyInActiveCircle", async () => {
    const { call, code } = await givenInvitedCircle();
    await call("POST", "/circles", "victor", createCircleBody("Mine", "Vic"));
    const preview = await call("POST", "/circles/join/preview", "victor", { inviteCode: code });
    const join = await call("POST", "/circles/join", "victor", joinCircleBody(code));
    expect([preview.status, preview.json.error.code]).toEqual([409, "AlreadyInActiveCircle"]);
    expect(preview.json.error).toEqual(join.json.error);
  });

  it("a missing or non-string code is a 422 validation error", async () => {
    const { call } = setup();
    const missing = await call("POST", "/circles/join/preview", "victor", {});
    const wrong = await call("POST", "/circles/join/preview", "victor", { inviteCode: 5 });
    expect([missing.status, wrong.status]).toEqual([422, 422]);
  });
});
