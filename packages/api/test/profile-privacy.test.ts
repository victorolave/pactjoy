import { describe, expect, it } from "vitest";
import { givenTwoMemberSeason } from "./entries-fixture.ts";

// Privacy by construction (ADR-0011 Q23): /me/profile describes the caller only, and no peer-facing
// read gains a consistency or stage field. OUTSIDE check: Andrea carries a sentinel (her habit
// name) and entries; Victor, her peer, reads everything he can.
// The fixture names her habit after her ("Run andrea"): that name never reaches Victor's profile.
const SENTINEL = "Run andrea";

const day = (d: number) => Date.UTC(2023, 10, 14 + d, 17);

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

/** Day 8: week 0 is over, so its three timesPerWeek sessions are counted. */
async function given(andreaLogs: boolean) {
  const ctx = await givenTwoMemberSeason();
  const { call, setNow, commitmentIds } = ctx;
  const habits = await call("GET", "/habits", "andrea");
  const andreaHabitId: string = habits.json.data.habits[0].id;
  const log = async (who: "andrea" | "victor", d: number, requestId: string) => {
    setNow(day(d) as never);
    const res = await call("POST", ctx.path, who, {
      commitmentId: commitmentIds[who],
      value: { kind: "done" },
      clientRequestId: requestId,
    });
    expect(res.status).toBe(201);
  };
  await log("victor", 3, "v-1");
  if (andreaLogs) {
    await log("andrea", 2, "a-1");
    await log("andrea", 3, "a-2");
    await log("andrea", 4, "a-3");
  }
  setNow(day(8) as never);
  return { ...ctx, andreaHabitId };
}

describe("GET /me/profile privacy (REQ-V1..V4)", () => {
  it("the peer's profile holds none of Andrea's sentinels, ids or figures", async () => {
    const { call, andreaHabitId, commitmentIds } = await given(true);
    const victor = await call("GET", "/me/profile", "victor");
    expect(victor.status).toBe(200);
    const text = JSON.stringify(victor.json);
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain(andreaHabitId);
    expect(text).not.toContain(commitmentIds.andrea);
    expect(victor.json.data.habits.map((h: { name: string }) => h.name)).toEqual(["Run victor"]);

    const andrea = await call("GET", "/me/profile", "andrea");
    expect(andrea.json.data.habits.map((h: { name: string }) => h.name)).toEqual([SENTINEL]);
    expect(andrea.json.data.consistency).toMatchObject({ kept: 3, counted: 3, percent: 100 });
  });

  it("the peer's figures do not move with Andrea's entries", async () => {
    const quiet = await given(false);
    const busy = await given(true);
    const before = await quiet.call("GET", "/me/profile", "victor");
    const after = await busy.call("GET", "/me/profile", "victor");
    expect(after.json).toEqual(before.json);
    expect(after.json.data.consistency).toMatchObject({ kept: 1, counted: 3 });
  });

  it("no peer-facing read gains a consistency or stage field", async () => {
    const { call, seasonId } = await given(true);
    const s = `/seasons/${seasonId}`;
    const circle = await call("GET", "/me/circle", "victor");
    const andreaMemberId: string = circle.json.data.circle.members.find(
      (m: { isYou: boolean }) => !m.isYou,
    ).id;
    const reads = [
      "/me/circle",
      "/me/today",
      s,
      `${s}/standings`,
      `${s}/members/${andreaMemberId}/progress`,
    ];
    for (const path of reads) {
      const res = await call("GET", path, "victor");
      expect([path, res.status]).toEqual([path, 200]);
      // The pact is shared, so a peer sees habit names there; what must not appear is a Perfil
      // field. The score and progress reads already carry their own kept/counted, so only the
      // fields that exist for the Perfil alone (inCurrentSeason, closedSeasons) are checked.
      const leaked = keysOf(res.json).filter((k) => /^(inCurrentSeason|closedSeasons)$/.test(k));
      expect([path, leaked]).toEqual([path, []]);
    }
  });

  it("/me/seasons and the habit list keep their shipped shape", async () => {
    const { call } = await given(true);
    const seasons = await call("GET", "/me/seasons", "victor");
    expect(seasons.json).toEqual({ data: { seasons: [] } });
    const habits = await call("GET", "/habits", "victor");
    expect(Object.keys(habits.json.data)).toEqual(["habits"]);
    expect(JSON.stringify(habits.json)).not.toContain(SENTINEL);
  });

  it("there is no member id to give: the path takes none", async () => {
    const { call } = await given(true);
    const res = await call("GET", "/me/profile/andrea", "victor");
    expect([res.status, res.json.error.code]).toEqual([404, "RouteNotFound"]);
  });
});
