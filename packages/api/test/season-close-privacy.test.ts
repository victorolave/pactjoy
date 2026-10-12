import { instant } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { givenTwoMemberSeason } from "./entries-fixture.ts";

// Privacy by construction (ADR-0015): closures, decisions and graduation are readable by their
// owner only, and the closure routes carry no member id. This is the OUTSIDE check: Andrea closes
// the season and graduates her habit; Victor, her peer, reads everything he can.
//
// The closure instant is a sentinel: it is unique to the decision, so finding it in any peer
// payload means a closure (or a graduation, which is stamped with the same instant) leaked.
const DECIDED = Date.UTC(2023, 11, 13, 17, 41, 13, 777);
const SENTINEL = "17:41:13.777";

/** Keys that would reveal a closure, a decision or a graduation. */
const FORBIDDEN_KEY = /closure|decision|graduat/i;

function keysOf(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) keysOf(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      keysOf(v, out);
    }
  }
  return out;
}

/** Andrea (and, when `everyone`, Victor too) closes the season; Andrea graduates her habit. */
async function given(everyone: boolean) {
  const ctx = await givenTwoMemberSeason();
  const { call, setNow, seasonId, commitmentIds } = ctx;
  setNow(instant(Date.UTC(2023, 11, 12, 17)));
  for (const who of ["andrea", "victor"] as const) {
    const done = await call("POST", `/seasons/${seasonId}/reviews/4`, who, {
      reflection: { helped: null, hard: null },
      automaticity: [{ commitmentId: commitmentIds[who], items: [4, 4, 5, 5] }],
    });
    expect(done.status).toBe(201);
  }
  setNow(instant(DECIDED));
  const closed = await call("POST", `/seasons/${seasonId}/closure`, "andrea", {
    decisions: [{ commitmentId: commitmentIds.andrea, decision: "graduate" }],
  });
  expect(closed.status).toBe(201);
  if (everyone) {
    // Victor closes a minute later, so his own instant is not the sentinel.
    setNow(instant(DECIDED + 60_000));
    const victor = await call("POST", `/seasons/${seasonId}/closure`, "victor", {
      decisions: [{ commitmentId: commitmentIds.victor, decision: "pause" }],
    });
    expect(victor.json.data.seasonClosed).toBe(true);
  }
  const circle = await call("GET", "/me/circle", "victor");
  const andreaMemberId: string = circle.json.data.circle.members.find(
    (m: { isYou: boolean }) => !m.isYou,
  ).id;
  return { ...ctx, andreaMemberId };
}

describe.each([
  ["while Andrea has closed and Victor has not", false],
  ["once everybody closed and the season is finalized", true],
])("peer reads never carry a closure, a decision or a graduation (%s)", (_name, everyone) => {
  it("SC-G4: every GET a peer can make on the data of a member who closed", async () => {
    const { call, seasonId, commitmentIds, andreaMemberId } = await given(everyone);
    const s = `/seasons/${seasonId}`;
    const peerReads = [
      s,
      `${s}/progress`,
      `${s}/members/${andreaMemberId}/progress`,
      `${s}/commitments/${commitmentIds.andrea}/progress`,
      `${s}/weeks/0/summary`,
      `${s}/score`,
      `${s}/members/${andreaMemberId}/score`,
      `${s}/standings`,
      "/me/circle",
      "/me/today",
      "/me/seasons",
    ];

    for (const path of peerReads) {
      const res = await call("GET", path, "victor");
      expect([path, res.status]).toEqual([path, 200]);
      expect([path, JSON.stringify(res.json).includes(SENTINEL)]).toEqual([path, false]);
      const leaked = keysOf(res.json).filter((k) => FORBIDDEN_KEY.test(k));
      expect([path, leaked]).toEqual([path, []]);
    }
  });

  it("the peer's own habit list shows his habits only: Andrea's graduated one is not there", async () => {
    const { call } = await given(everyone);
    const res = await call("GET", "/habits", "victor");
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).not.toContain(SENTINEL);
    expect(res.json.data.habits.map((h: { name: string }) => h.name)).toEqual(["Run victor"]);
    expect(
      res.json.data.habits.every((h: { graduatedAt: unknown }) => h.graduatedAt === null),
    ).toBe(true);
  });

  it("the peer's own results and carry-over hold only HIS closure state", async () => {
    const { call, seasonId, commitmentIds } = await given(everyone);
    const results = await call("GET", `/seasons/${seasonId}/results`, "victor");
    expect(results.status).toBe(200);
    expect(JSON.stringify(results.json)).not.toContain(SENTINEL);
    expect(
      results.json.data.commitments.map((c: { commitmentId: string }) => c.commitmentId),
    ).toEqual([commitmentIds.victor]);
    // Victor's own decisions, when he has closed, are a "pause": never Andrea's graduate.
    const decisions: { decision: string }[] = results.json.data.closure?.decisions ?? [];
    expect(decisions.every((d) => d.decision === "pause")).toBe(true);
    expect(
      results.json.data.commitments.every((c: { stage: string }) => c.stage !== "graduated"),
    ).toBe(true);
  });

  it("a peer cannot address Andrea's closure, results or carry-over: there is no member id to give", async () => {
    const { call, seasonId, andreaMemberId } = await given(everyone);
    for (const suffix of ["results", "closure", "carry-over"]) {
      const res = await call(
        "GET",
        `/seasons/${seasonId}/members/${andreaMemberId}/${suffix}`,
        "victor",
      );
      expect([suffix, res.status, res.json.error.code]).toEqual([suffix, 404, "RouteNotFound"]);
    }
    const mine = await call(
      "GET",
      `/seasons/${seasonId}/results?memberId=${andreaMemberId}`,
      "victor",
    );
    expect(mine.status).toBe(200);
    expect(JSON.stringify(mine.json)).not.toContain(SENTINEL);
  });

  it("the owner sees her own graduation: it is private, not absent", async () => {
    const { call, seasonId } = await given(everyone);
    const results = await call("GET", `/seasons/${seasonId}/results`, "andrea");
    expect(results.json.data.commitments.map((c: { stage: string }) => c.stage)).toEqual([
      "graduated",
    ]);
    const habits = await call("GET", "/habits", "andrea");
    expect(habits.json.data.habits[0].graduatedAt).toBe("2023-12-13T17:41:13.777Z");
  });
});
