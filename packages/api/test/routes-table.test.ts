import { describe, expect, it, type Mock, vi } from "vitest";
import { ANDREA, setup } from "./harness.ts";

// RT-S4 / AC-S8: the route table is complete and every route is wired to ITS use case. The use
// cases are replaced by spies, so this checks wiring only; behaviour lives in the route tests.
const { spies, USE_CASE_NAMES } = vi.hoisted(() => ({
  spies: {} as Record<string, Mock>,
  USE_CASE_NAMES: [
    "createCircle",
    "renameCircle",
    "renameMyDisplayName",
    "generateInvite",
    "joinCircle",
    "leaveCircle",
    "createHabit",
    "listMyHabits",
    "updateHabit",
    "previewProgress",
    "createSeason",
    "editSeasonParams",
    "addCommitment",
    "editCommitment",
    "removeCommitment",
    "approvePact",
    "withdrawApproval",
    "recordEntry",
    "editEntry",
    "deleteEntry",
    "memberScore",
    "seasonProgress",
    "memberProgress",
    "commitmentProgress",
    "weekSummary",
    "standings",
    "today",
    "seasonView",
  ] as string[],
}));

vi.mock("@pactjoy/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pactjoy/app")>();
  const stubbed: Record<string, unknown> = {};
  for (const name of USE_CASE_NAMES) {
    spies[name] = vi.fn(async () => ({ ok: false, error: { kind: "SeasonNotFound" } }));
    stubbed[name] = spies[name];
  }
  return { ...actual, ...stubbed };
});

const ID = "aaaaaaaa-0000-4000-8000-0000000000aa";
const ID2 = "bbbbbbbb-0000-4000-8000-0000000000bb";
const MEASURE = { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } };

type Row = [useCase: string, method: string, path: string, body?: unknown];
const TABLE: Row[] = [
  ["createCircle", "POST", "/circles", { name: "Crew", displayName: "Ana" }],
  ["renameCircle", "PATCH", `/circles/${ID}`, { name: "Crew" }],
  ["renameMyDisplayName", "PATCH", `/circles/${ID}/members/me`, { displayName: "Ana" }],
  ["generateInvite", "POST", `/circles/${ID}/invite`],
  ["joinCircle", "POST", "/circles/join", { inviteCode: "ABCDEF", displayName: "Vic" }],
  ["leaveCircle", "POST", `/circles/${ID}/leave`],
  ["createHabit", "POST", "/habits", { name: "Run" }],
  ["listMyHabits", "GET", "/habits"],
  [
    "previewProgress",
    "POST",
    "/scoring/preview",
    { measure: { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } }, values: ["1"] },
  ],
  ["updateHabit", "PATCH", `/habits/${ID}`, { expectedVersion: 0 }],
  [
    "createSeason",
    "POST",
    `/circles/${ID}/seasons`,
    { timezone: "America/Bogota", startDate: "2023-11-14", lengthWeeks: 4 },
  ],
  ["editSeasonParams", "PATCH", `/seasons/${ID}`, { lengthWeeks: 6 }],
  [
    "addCommitment",
    "POST",
    `/seasons/${ID}/commitments`,
    { habitId: ID2, weightPercent: 100, privacy: "visible", measure: MEASURE },
  ],
  [
    "editCommitment",
    "PUT",
    `/seasons/${ID}/commitments/${ID2}`,
    { weightPercent: 100, privacy: "visible", measure: MEASURE },
  ],
  ["removeCommitment", "DELETE", `/seasons/${ID}/commitments/${ID2}`],
  ["approvePact", "PUT", `/seasons/${ID}/approval`, { expectedPactRevision: 0 }],
  ["withdrawApproval", "DELETE", `/seasons/${ID}/approval`],
  [
    "recordEntry",
    "POST",
    `/seasons/${ID}/entries`,
    { commitmentId: ID2, value: { kind: "done" }, clientRequestId: "r-1" },
  ],
  ["editEntry", "PUT", `/entries/${ID}`, { value: { kind: "done" }, note: null }],
  ["deleteEntry", "DELETE", `/entries/${ID}`],
  ["memberScore", "GET", `/seasons/${ID}/score`],
  ["memberScore", "GET", `/seasons/${ID}/members/${ID2}/score`],
  ["seasonProgress", "GET", `/seasons/${ID}/progress`],
  ["memberProgress", "GET", `/seasons/${ID}/members/${ID2}/progress`],
  ["commitmentProgress", "GET", `/seasons/${ID}/commitments/${ID2}/progress`],
  ["weekSummary", "GET", `/seasons/${ID}/weeks/3/summary`],
  ["standings", "GET", `/seasons/${ID}/standings`],
  ["today", "GET", "/me/today"],
  ["seasonView", "GET", `/seasons/${ID}`],
];

describe("route table completeness (RT-S4)", () => {
  it("has 29 routes over exactly the 28 use cases, the score one routed twice", () => {
    expect(TABLE).toHaveLength(29);
    expect(new Set(TABLE.map(([name]) => name))).toEqual(new Set(USE_CASE_NAMES));
    expect(TABLE.filter(([name]) => name === "memberScore")).toHaveLength(2);
  });

  it.each(TABLE)(
    "%s: %s %s is routed (not 404 RouteNotFound, not 405)",
    async (_n, method, path, body) => {
      const { call } = setup();
      const res = await call(method, path, "andrea", body);
      expect(res.status).not.toBe(405);
      expect(res.json.error?.code).not.toBe("RouteNotFound");
    },
  );

  it("a known path with the wrong method is 405, never a use case call", async () => {
    const { call } = setup();
    for (const [method, path] of [
      ["GET", "/circles"],
      ["PUT", "/habits"],
      ["DELETE", `/habits/${ID}`],
      ["POST", `/seasons/${ID}/standings`],
      ["DELETE", `/seasons/${ID}/score`],
      ["PATCH", `/entries/${ID}`],
    ] as const) {
      const res = await call(method, path, "andrea");
      expect([method, path, res.status]).toEqual([method, path, 405]);
    }
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  });
});

describe("route to use case wiring (AC-S8)", () => {
  it.each(TABLE)(
    "%s: %s %s calls only its use case, once, as the token's actor",
    async (name, method, path, body) => {
      for (const spy of Object.values(spies)) spy.mockClear();
      const { call } = setup();
      await call(method, path, "andrea", body);
      for (const [other, spy] of Object.entries(spies)) {
        expect([other, spy.mock.calls.length]).toEqual([other, other === name ? 1 : 0]);
      }
      const args = spies[name]?.mock.calls[0] ?? [];
      if (name === "previewProgress") {
        expect(args[0]).toEqual({ userId: ANDREA });
        expect(args[1]).toEqual(body);
        return;
      }
      const [deps, actor] = args;
      expect(actor).toEqual({ userId: ANDREA });
      expect(deps).toHaveProperty("uow");
      expect(deps).toHaveProperty("clock");
      if (name === "seasonProgress") expect(args[2]).toEqual({ seasonId: ID });
      if (name === "memberProgress") expect(args[2]).toEqual({ seasonId: ID, memberId: ID2 });
      if (name === "commitmentProgress")
        expect(args[2]).toEqual({ seasonId: ID, commitmentId: ID2 });
      if (name === "weekSummary") expect(args[2]).toEqual({ seasonId: ID, weekIndex: 3 });
    },
  );

  it("a stubbed use case failure is the mapped app error, nothing else is invented", async () => {
    const { call } = setup();
    const res = await call("GET", `/seasons/${ID}/standings`, "andrea");
    expect([res.status, res.json]).toEqual([
      404,
      { error: { code: "SeasonNotFound", message: "SeasonNotFound" } },
    ]);
  });
});
