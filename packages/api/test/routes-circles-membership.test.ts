import { seasonId } from "@pactjoy/app";
import { seasonFixture } from "@pactjoy/app/testing";
import { describe, expect, it, vi } from "vitest";
import { ANDREA, setup, UNKNOWN_CIRCLE, VICTOR } from "./harness.ts";

/** Andrea owns a circle with an invite; returns the circle id and the code. */
async function givenInvitedCircle() {
  const ctx = setup();
  const created = await ctx.call("POST", "/circles", "andrea", { name: "Crew" });
  const circleId: string = created.json.data.id;
  const invite = await ctx.call("POST", `/circles/${circleId}/invite`, "andrea");
  return { ...ctx, circleId, code: invite.json.data.code as string };
}

describe("POST /circles/join (UE-C-S6..S8)", () => {
  it("S6: 200 joins with the code in the body; lowercase and padded codes are accepted", async () => {
    const { call, code } = await givenInvitedCircle();
    const { status, json } = await call("POST", "/circles/join", "victor", {
      inviteCode: ` ${code.toLowerCase()} `,
    });
    expect(status).toBe(200);
    expect(json.data.members).toHaveLength(2);
    expect(json.data.invite.code).toBe(code); // the joiner is an active viewer, so the invite shows
    expect(json.data.members.filter((m: { isYou: boolean }) => m.isYou)).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain(VICTOR);
  });

  it("S7: 404 InviteNotFound for a well-formed code nobody owns", async () => {
    const { call } = await givenInvitedCircle();
    const { status, json } = await call("POST", "/circles/join", "victor", {
      inviteCode: "AAAAAA",
    });
    expect([status, json.error.code]).toEqual([404, "InviteNotFound"]);
  });

  it("S8: 409 AlreadyInActiveCircle for a member of another circle", async () => {
    const { call, code } = await givenInvitedCircle();
    await call("POST", "/circles", "victor", { name: "Mine" });
    const { status, json } = await call("POST", "/circles/join", "victor", { inviteCode: code });
    expect([status, json.error.code]).toEqual([409, "AlreadyInActiveCircle"]);
  });

  it("410 InviteExpired once the invite is past its expiry", async () => {
    const { app, call, circleId, code } = await givenInvitedCircle();
    const circle = await app.circles.get(circleId as never);
    if (!circle?.invite) throw new Error("fixture setup failed");
    await app.circles.save(
      { ...circle, invite: { ...circle.invite, expiresAt: app.clock.now() }, version: 9 },
      circle.version,
    );
    const { status, json } = await call("POST", "/circles/join", "victor", { inviteCode: code });
    expect([status, json.error.code]).toEqual([410, "InviteExpired"]);
  });

  it("409 CircleFull at six active members", async () => {
    const { app, call, circleId, code } = await givenInvitedCircle();
    const circle = await app.circles.get(circleId as never);
    if (!circle?.members[0]) throw new Error("fixture setup failed");
    const owner = circle.members[0];
    const fillers = [1, 2, 3, 4, 5].map((n) => ({
      ...owner,
      id: `filler-${n}` as never,
      userId: `u-${n}` as never,
    }));
    await app.circles.save(
      { ...circle, members: [...circle.members, ...fillers], version: 9 },
      circle.version,
    );
    const { status, json } = await call("POST", "/circles/join", "victor", { inviteCode: code });
    expect([status, json.error.code]).toEqual([409, "CircleFull"]);
  });

  it("S6 (UE-C-S6): 409 SeasonNotJoinable while the circle has an active season", async () => {
    const { app, call, circleId, code } = await givenInvitedCircle();
    await app.seasons.save(
      seasonFixture({
        id: seasonId("cccccccc-0000-4000-8000-000000000001"),
        circleId: circleId as never,
        status: "active",
      }),
      null,
    );
    const { status, json } = await call("POST", "/circles/join", "victor", { inviteCode: code });
    expect([status, json.error.code]).toEqual([409, "SeasonNotJoinable"]);
  });

  it("422 unknownField: the legacy `code` field is no longer accepted", async () => {
    const { call, transaction } = await givenInvitedCircle();
    transaction.mockClear();
    const { status, json } = await call("POST", "/circles/join", "victor", { code: "AAAAAA" });
    expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(json.error.details.issues).toContainEqual({ path: "code", problem: "unknownField" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("409 CircleArchived for an archived circle", async () => {
    const { app, call, circleId, code } = await givenInvitedCircle();
    const circle = await app.circles.get(circleId as never);
    if (!circle) throw new Error("fixture setup failed");
    await app.circles.save({ ...circle, archivedAt: app.clock.now(), version: 9 }, circle.version);
    const { status, json } = await call("POST", "/circles/join", "victor", { inviteCode: code });
    expect([status, json.error.code]).toEqual([409, "CircleArchived"]);
  });

  it.each([
    ["wrong length", { inviteCode: "ABC" }, "format"],
    ["ambiguous characters (0 O 1 I L)", { inviteCode: "AB0O1I" }, "format"],
    ["oversized", { inviteCode: "A".repeat(65) }, "format"],
    ["not a string", { inviteCode: 123456 }, "type"],
    ["missing", {}, "required"],
    ["unknown field", { inviteCode: "AAAAAA", circleId: UNKNOWN_CIRCLE }, "unknownField"],
    ["no body", undefined, "required"],
  ])(
    "RV-S18..S20: 422 InvalidRequest on %s; the invite lookup never runs",
    async (_l, body, problem) => {
      const { app, call, transaction, read } = await givenInvitedCircle();
      const lookup = vi.spyOn(app.circles, "findByInviteCode");
      transaction.mockClear();
      const { status, json } = await call("POST", "/circles/join", "victor", body);
      expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
      expect(json.error.details.issues[0].problem).toBe(problem);
      expect(lookup).not.toHaveBeenCalled();
      expect(transaction).not.toHaveBeenCalled();
      expect(read).not.toHaveBeenCalled();
    },
  );
});

describe("POST /circles/:circleId/leave", () => {
  it("200 marks the caller as left; again gives 403 NotAMember; unknown circle 404", async () => {
    const { call, circleId, code } = await givenInvitedCircle();
    await call("POST", "/circles/join", "victor", { inviteCode: code });
    const left = await call("POST", `/circles/${circleId}/leave`, "victor");
    expect(left.status).toBe(200);
    expect(left.json.data.members.find((m: { isYou: boolean }) => m.isYou).status).toBe("left");
    expect(left.json.data.invite).toBeNull(); // a leaver is no longer an active viewer
    const again = await call("POST", `/circles/${circleId}/leave`, "victor", {});
    expect([again.status, again.json.error.code]).toEqual([403, "NotAMember"]);
    const missing = await call("POST", `/circles/${UNKNOWN_CIRCLE}/leave`, "andrea");
    expect([missing.status, missing.json.error.code]).toEqual([404, "CircleNotFound"]);
  });

  it("the last member leaving archives the circle", async () => {
    const { call, circleId } = await givenInvitedCircle();
    const { json } = await call("POST", `/circles/${circleId}/leave`, "andrea");
    expect(json.data.archivedAt).not.toBeNull();
  });

  it.each([
    ["malformed circleId", "/circles/not-a-uuid/leave", undefined, "circleId"],
    ["body with fields", `/circles/${UNKNOWN_CIRCLE}/leave`, { userId: ANDREA }, "userId"],
  ])("422 on %s, no repository call", async (_l, path, body, field) => {
    const { call, transaction, read } = setup();
    const { status, json } = await call("POST", path, "andrea", body);
    expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(json.error.details.issues[0].path).toBe(field);
    expect(transaction).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});

describe("authentication", () => {
  it.each([
    ["/circles/join", { inviteCode: "AAAAAA" }],
    [`/circles/${UNKNOWN_CIRCLE}/leave`, undefined],
  ])("401 without a token: POST %s", async (path, body) => {
    const { call, transaction } = setup();
    const { status, json } = await call("POST", path, null, body);
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
    expect(transaction).not.toHaveBeenCalled();
  });
});
