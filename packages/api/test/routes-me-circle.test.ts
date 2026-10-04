import { circleId, instant, type MyCircleView, memberId, seasonId } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { presentMyCircle } from "../src/presenters/circle.ts";
import { createCircleBody, joinCircleBody } from "../src/testing/index.ts";
import { setup } from "./harness.ts";

const T = instant(1_700_000_000_123);
const ISO = "2023-11-14T22:13:20.123Z";

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keysDeep(v, out);
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.add(k);
      keysDeep(v, out);
    }
  }
  return out;
}

describe("GET /me/circle (CR-R1..R3)", () => {
  it("CR-S4: 401 without a token and with an unknown one", async () => {
    const { call } = setup();
    const none = await call("GET", "/me/circle", null);
    const bad = await call("GET", "/me/circle", "nobody");
    expect([none.status, bad.status]).toEqual([401, 401]);
  });

  it("CR-S2: no circle is 200 with nulls, not 404", async () => {
    const { call } = setup();
    const res = await call("GET", "/me/circle", "andrea");
    expect([res.status, res.json]).toEqual([200, { data: { circle: null, season: null } }]);
  });

  it("returns the viewer's circle with isYou, active members only and no user ids", async () => {
    const { call } = setup();
    const created = await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    const id: string = created.json.data.id;
    const invite = await call("POST", `/circles/${id}/invite`, "andrea");
    await call("POST", "/circles/join", "victor", joinCircleBody(invite.json.data.code));
    const mine = await call("GET", "/me/circle", "andrea");
    const theirs = await call("GET", "/me/circle", "victor");
    expect(mine.status).toBe(200);
    expect(mine.json.data.circle.id).toBe(id);
    expect(mine.json.data.circle.members.map((m: { isYou: boolean }) => m.isYou)).toEqual([
      true,
      false,
    ]);
    expect(theirs.json.data.circle.members.map((m: { isYou: boolean }) => m.isYou)).toEqual([
      false,
      true,
    ]);
    expect(mine.json.data.season).toBeNull();
    expect(keysDeep(mine.json).has("userId")).toBe(false);
  });

  it("CR-S3: a member who left sees no circle", async () => {
    const { call } = setup();
    const created = await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    await call("POST", `/circles/${created.json.data.id}/leave`, "andrea");
    const res = await call("GET", "/me/circle", "andrea");
    expect(res.json).toEqual({ data: { circle: null, season: null } });
  });

  it("the invite carries only code and instants", async () => {
    const { call } = setup();
    const created = await call("POST", "/circles", "andrea", createCircleBody("Crew"));
    await call("POST", `/circles/${created.json.data.id}/invite`, "andrea");
    const res = await call("GET", "/me/circle", "andrea");
    expect(Object.keys(res.json.data.circle.invite).sort()).toEqual([
      "code",
      "createdAt",
      "expiresAt",
    ]);
  });
});

describe("presentMyCircle", () => {
  const view: MyCircleView = {
    circle: {
      id: circleId("c1"),
      name: "Pals",
      members: [{ id: memberId("m1"), displayName: "Me", joinedAt: T, isYou: true }],
      invite: { code: "AB3D7K" as never, createdAt: T, expiresAt: instant(T + 1000) },
    },
    season: {
      id: seasonId("s1"),
      phase: "active",
      lengthWeeks: 6,
      week: 2,
      approvalCount: 3,
    },
  };

  it("maps every field, with ISO instants", () => {
    expect(presentMyCircle(view)).toEqual({
      circle: {
        id: "c1",
        name: "Pals",
        members: [{ id: "m1", displayName: "Me", joinedAt: ISO, isYou: true }],
        invite: { code: "AB3D7K", createdAt: ISO, expiresAt: "2023-11-14T22:13:21.123Z" },
      },
      season: { id: "s1", phase: "active", lengthWeeks: 6, week: 2, approvalCount: 3 },
    });
  });

  it("keeps nulls: no circle, no invite", () => {
    expect(presentMyCircle({ circle: null, season: null })).toEqual({ circle: null, season: null });
    if (!view.circle) throw new Error("fixture");
    const bare = presentMyCircle({ circle: { ...view.circle, invite: null }, season: null });
    expect(bare.circle?.invite).toBeNull();
  });
});
