import { type CircleId, instant, seasonId } from "@pactjoy/app";
import { seasonFixture } from "@pactjoy/app/testing";
import { describe, expect, it, vi } from "vitest";
import { createCircleBody, joinCircleBody } from "../src/testing/index.ts";
import { ANDREA, setup, UNKNOWN_CIRCLE, VICTOR } from "./harness.ts";

/** Andrea owns a circle with an invite; returns the circle id and the code. */
async function givenInvitedCircle() {
  const ctx = setup();
  const created = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew"));
  const circleId: string = created.json.data.id;
  const invite = await ctx.call("POST", `/circles/${circleId}/invite`, "andrea");
  return { ...ctx, circleId, code: invite.json.data.code as string };
}

describe("POST /circles/join (UE-C-S6..S8)", () => {
  it("S6: 200 joins with the code in the body; lowercase and padded codes are accepted", async () => {
    const { app, call, code, circleId } = await givenInvitedCircle();
    const { status, json } = await call("POST", "/circles/join", "victor", {
      inviteCode: ` ${code.toLowerCase()} `,
      displayName: "  Vic ",
    });
    expect(status).toBe(200);
    expect(json.data.members).toHaveLength(2);
    expect((await app.circles.get(circleId as CircleId))?.members[1]?.displayName).toBe("Vic");
    expect(json.data.invite.code).toBe(code); // the joiner is an active viewer, so the invite shows
    expect(Object.keys(json.data.invite).sort()).toEqual(["code", "createdAt", "expiresAt"]);
    expect(json.data.invite).not.toHaveProperty("createdBy");
    expect(json.data.members.filter((m: { isYou: boolean }) => m.isYou)).toHaveLength(1);
    expect(JSON.stringify(json)).not.toContain(VICTOR);
  });

  it("SQ-13: a successful join returns the circle DTO with every active member's display name, the joiner's included", async () => {
    const ctx = setup();
    const created = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew", "Zoe"));
    const invite = await ctx.call("POST", `/circles/${created.json.data.id}/invite`, "andrea");
    const { status, json } = await ctx.call(
      "POST",
      "/circles/join",
      "victor",
      joinCircleBody(invite.json.data.code, "Vic"),
    );
    expect(status).toBe(200);
    expect(json.data.members.map((m: { displayName: string }) => m.displayName).sort()).toEqual([
      "Vic",
      "Zoe",
    ]);
  });

  it("UE-C-S13: a blank or 31 code point display name is InvalidDisplayName 422", async () => {
    const { call, code } = await givenInvitedCircle();
    for (const displayName of ["   ", "a".repeat(31)]) {
      const { status, json } = await call("POST", "/circles/join", "victor", {
        inviteCode: code,
        displayName,
      });
      expect([status, json.error.code]).toEqual([422, "InvalidDisplayName"]);
    }
  });

  it.each([
    ["not a string", { displayName: 5 }, "type"],
    ["missing", {}, "required"],
  ])(
    "UE-C-S14 / RV-R11: displayName %s is InvalidRequest, use case not called",
    async (_label, extra, problem) => {
      const { call, code, transaction } = await givenInvitedCircle();
      transaction.mockClear();
      const { status, json } = await call("POST", "/circles/join", "victor", {
        inviteCode: code,
        ...extra,
      });
      expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
      expect(json.error.details.issues).toContainEqual({ path: "displayName", problem });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("UE-C-S12: 409 DisplayNameTaken for a name an active member holds, in any case", async () => {
    const { call, code } = await givenInvitedCircle(); // the creator is "Creator"
    const { status, json } = await call("POST", "/circles/join", "victor", {
      inviteCode: code,
      displayName: " cREATOR ",
    });
    expect([status, json.error.code]).toEqual([409, "DisplayNameTaken"]);
  });

  it("S7: 404 InviteNotFound for a well-formed code nobody owns", async () => {
    const { call } = await givenInvitedCircle();
    const { status, json } = await call(
      "POST",
      "/circles/join",
      "victor",
      joinCircleBody("AAAAAA"),
    );
    expect([status, json.error.code]).toEqual([404, "InviteNotFound"]);
  });

  it("SQ-13: no failed join reveals the display name of an existing member", async () => {
    const ctx = setup();
    const created = await ctx.call("POST", "/circles", "andrea", createCircleBody("Crew", "Zoe"));
    const invite = await ctx.call("POST", `/circles/${created.json.data.id}/invite`, "andrea");
    const code: string = invite.json.data.code;
    const taken = await ctx.call("POST", "/circles/join", "victor", joinCircleBody(code, " ZOE "));
    expect(taken.json.error.code).toBe("DisplayNameTaken");
    expect(JSON.stringify(taken.json)).not.toContain("Zoe");
    const attempts = [
      { inviteCode: code, displayName: "   " }, // InvalidDisplayName
      joinCircleBody("AAAAAA", "Joiner"), // InviteNotFound
    ];
    await ctx.call("POST", "/circles", "victor", createCircleBody("Mine", "Vic"));
    attempts.push(joinCircleBody(code, "Joiner")); // AlreadyInActiveCircle
    for (const body of attempts) {
      const { json } = await ctx.call("POST", "/circles/join", "victor", body);
      expect(json.error).toBeDefined();
      expect(JSON.stringify(json)).not.toMatch(/zoe/i);
    }
  });

  it("S8: 409 AlreadyInActiveCircle for a member of another circle", async () => {
    const { call, code } = await givenInvitedCircle();
    await call("POST", "/circles", "victor", createCircleBody("Mine"));
    const { status, json } = await call("POST", "/circles/join", "victor", joinCircleBody(code));
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
    const { status, json } = await call("POST", "/circles/join", "victor", joinCircleBody(code));
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
    const { status, json } = await call("POST", "/circles/join", "victor", joinCircleBody(code));
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
    const { status, json } = await call("POST", "/circles/join", "victor", joinCircleBody(code));
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
    const { status, json } = await call("POST", "/circles/join", "victor", joinCircleBody(code));
    expect([status, json.error.code]).toEqual([409, "CircleArchived"]);
  });

  it.each([
    ["wrong length", { inviteCode: "ABC" }, "format"],
    ["ambiguous characters (0 O 1 I L)", { inviteCode: "AB0O1I" }, "format"],
    ["oversized", { inviteCode: "A".repeat(65) }, "format"],
    ["not a string", { inviteCode: 123456 }, "type"],
    ["missing", {}, "required"],
    [
      "unknown field",
      { inviteCode: "AAAAAA", displayName: "Vic", circleId: UNKNOWN_CIRCLE },
      "unknownField",
    ],
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
    await call("POST", "/circles/join", "victor", joinCircleBody(code));
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

describe("PATCH /circles/:circleId/members/me (UE-C-S15, RV-R11)", () => {
  /** Andrea and Victor ("Vic") share a circle. */
  async function givenTwoMembers() {
    const ctx = await givenInvitedCircle();
    await ctx.call("POST", "/circles/join", "victor", {
      inviteCode: ctx.code,
      displayName: "Vic",
    });
    return { ...ctx, path: `/circles/${ctx.circleId}/members/me` };
  }

  it("200 renames the caller's own name, trimmed, and returns the circle", async () => {
    const { app, call, path, circleId } = await givenTwoMembers();
    const before = await app.circles.get(circleId as CircleId);
    const { status, json } = await call("PATCH", path, "victor", { displayName: "  Victor " });
    expect(status).toBe(200);
    expect(json.data.id).toBe(circleId);
    expect(json.data.version).toBe((before?.version ?? 0) + 1);
    const mine = json.data.members.find((m: { isYou: boolean }) => m.isYou);
    expect(mine.displayName).toBe("Victor");
    expect(JSON.stringify(json)).not.toContain(VICTOR);
  });

  it("a case-only change of one's own name is 200", async () => {
    const { call, path } = await givenTwoMembers();
    const { status } = await call("PATCH", path, "victor", { displayName: "VIC" });
    expect(status).toBe(200);
  });

  it("409 DisplayNameTaken for another active member's name", async () => {
    const { call, path } = await givenTwoMembers();
    const { status, json } = await call("PATCH", path, "victor", { displayName: "creator" });
    expect([status, json.error.code]).toEqual([409, "DisplayNameTaken"]);
  });

  it("422 InvalidDisplayName for a blank or 31 code point name", async () => {
    const { call, path } = await givenTwoMembers();
    for (const displayName of ["   ", "a".repeat(31)]) {
      const { status, json } = await call("PATCH", path, "victor", { displayName });
      expect([status, json.error.code]).toEqual([422, "InvalidDisplayName"]);
    }
  });

  it("403 for a non-member; 404 for an unknown circle", async () => {
    const { call, path } = await givenInvitedCircle().then((c) => ({
      ...c,
      path: `/circles/${c.circleId}/members/me`,
    }));
    const outsider = await call("PATCH", path, "victor", { displayName: "Vic" });
    expect([outsider.status, outsider.json.error.code]).toEqual([403, "NotAMember"]);
    const missing = await call("PATCH", `/circles/${UNKNOWN_CIRCLE}/members/me`, "andrea", {
      displayName: "Ana",
    });
    expect([missing.status, missing.json.error.code]).toEqual([404, "CircleNotFound"]);
  });

  it("409 CircleArchived on an archived circle", async () => {
    const { app, call, path, circleId } = await givenTwoMembers();
    const circle = await app.circles.get(circleId as CircleId);
    if (!circle) throw new Error("seed failed");
    await app.circles.save(
      { ...circle, archivedAt: instant(1), version: circle.version + 1 },
      circle.version,
    );
    const { status, json } = await call("PATCH", path, "victor", { displayName: "Vic 2" });
    expect([status, json.error.code]).toEqual([409, "CircleArchived"]);
  });

  it.each([
    ["not a string", { displayName: 5 }, "displayName", "type"],
    ["missing", {}, "displayName", "required"],
    [
      "a memberId (the actor comes from the token only)",
      { displayName: "Vic", memberId: "x" },
      "memberId",
      "unknownField",
    ],
  ])(
    "422 InvalidRequest, use case not called: displayName %s",
    async (_l, body, field, problem) => {
      const { call, path, transaction } = await givenTwoMembers();
      transaction.mockClear();
      const { status, json } = await call("PATCH", path, "victor", body);
      expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
      expect(json.error.details.issues).toContainEqual({ path: field, problem });
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it("401 without a token", async () => {
    const { call, transaction } = setup();
    const { status, json } = await call("PATCH", `/circles/${UNKNOWN_CIRCLE}/members/me`, null, {
      displayName: "x",
    });
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
    expect(transaction).not.toHaveBeenCalled();
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
