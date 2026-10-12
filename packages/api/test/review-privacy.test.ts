import { instant } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { givenTwoMemberSeason } from "./entries-fixture.ts";

// Privacy by construction (ADR-0014): the review port has no peer read, and the four review routes
// carry no member id. This is the OUTSIDE check: a sentinel scan over every peer-facing read.
// SC-100..102, SC-105.
const REFLECTION = "SENTINEL-REFLECTION-7f3a91";
const HARD = "SENTINEL-HARD-c42e08";
const at = (month: number, day: number) => instant(Date.UTC(2023, month - 1, day, 17));

/** Keys that would reveal a review, an automaticity answer, a reflection or a stage. */
// "review" is matched at a word start so "resumePreviews" (pause) is not a false positive.
const FORBIDDEN_KEY =
  /(?<![A-Za-z])review|Review|[Aa]utomaticity|[Rr]eflection|[Ss]tage|[Ss]rbai|SRBAI|[Bb]aseline|[Ss]kipped/;
/** The owner's own Today carries these two (and only these) by design (REQ-V2). */
const OWN_TODAY_KEYS = new Set(["pendingReview", "baselineOffer"]);
/** Season parameters, not review data. */
const ALLOWED_KEYS = new Set(["reviewCadenceWeeks"]);

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

/** Both members hold a stored review with sentinel text, and Andrea also has a pause for Victor to approve. */
async function given() {
  const ctx = await givenTwoMemberSeason();
  const { call, setNow, seasonId, commitmentIds } = ctx;
  const answer = (who: "andrea" | "victor", items: (number | null)[]) => ({
    commitmentId: commitmentIds[who],
    items,
  });

  // Day 1: Andrea answers the baseline and Victor skips it.
  const baseline = await call("POST", `/seasons/${seasonId}/reviews/0`, "andrea", {
    reflection: { helped: REFLECTION, hard: HARD },
    automaticity: [answer("andrea", [2, 3, 4, 5])],
  });
  const skipped = await call("POST", `/seasons/${seasonId}/reviews/0/skip`, "victor");
  // Day 8: Andrea answers review 1 with reflections; Victor leaves it pending.
  setNow(at(11, 21));
  const interim = await call("POST", `/seasons/${seasonId}/reviews/1`, "andrea", {
    reflection: { helped: REFLECTION, hard: HARD },
    automaticity: [answer("andrea", [6, null, null, null])],
  });
  const pause = await call("POST", `/seasons/${seasonId}/pause-requests`, "andrea", {
    scope: { kind: "commitment", commitmentId: commitmentIds.andrea },
    reason: "health",
    note: null,
    startDate: "2023-11-22",
    endDate: "2023-11-23",
  });
  expect([baseline.status, skipped.status, interim.status, pause.status]).toEqual([
    201, 200, 201, 201,
  ]);

  const circle = await call("GET", "/me/circle", "victor");
  const andreaMemberId: string = circle.json.data.circle.members.find(
    (m: { isYou: boolean }) => !m.isYou,
  ).id;
  return { ...ctx, andreaMemberId, pauseId: pause.json.data.id as string };
}

describe("peer reads never carry a review, an automaticity answer, a reflection or a stage", () => {
  it("SC-100: every GET a peer can make, on the data of a member with reviews", async () => {
    const { call, seasonId, commitmentIds, andreaMemberId } = await given();
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
      "/me/pause-requests",
      "/habits",
    ];

    for (const path of peerReads) {
      const res = await call("GET", path, "victor");
      expect([path, res.status]).toEqual([path, 200]);
      const text = JSON.stringify(res.json);
      expect([path, text.includes(REFLECTION), text.includes(HARD)]).toEqual([path, false, false]);
      const leaked = keysOf(res.json).filter((k) => FORBIDDEN_KEY.test(k) && !ALLOWED_KEYS.has(k));
      expect([path, leaked]).toEqual([path, []]);
    }
  });

  it("SC-100: the pause approval Victor answers carries no review data either", async () => {
    const { call, pauseId } = await given();
    const res = await call("PUT", `/pause-requests/${pauseId}/response`, "victor", {
      decision: "approve",
    });
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.json)).not.toContain(REFLECTION);
    expect(keysOf(res.json).filter((k) => FORBIDDEN_KEY.test(k))).toEqual([]);
  });

  it("SC-100: Today forwards the review fields to the owner only", async () => {
    const { call } = await given();
    const victor = await call("GET", "/me/today", "victor");
    const andrea = await call("GET", "/me/today", "andrea");

    for (const res of [victor, andrea]) {
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.json)).not.toContain(REFLECTION);
      const keys = keysOf(res.json).filter((k) => FORBIDDEN_KEY.test(k) && !ALLOWED_KEYS.has(k));
      // Only the offer / pending review (the viewer's own) and nothing about answers or stages.
      expect(keys.filter((k) => !OWN_TODAY_KEYS.has(k) && !/^(fullSrbai)$/.test(k))).toEqual([]);
    }
    // Victor's own review is still pending; Andrea has answered hers: each sees only their own state.
    expect(victor.json.data.pendingReview).not.toBeNull();
    expect(victor.json.data.baselineOffer).toBeNull();
    expect(andrea.json.data.pendingReview).toBeNull();
  });

  it("SC-101: the owner-only routes carry no member id, so a peer's review or stage cannot be asked for", async () => {
    const { call, seasonId, commitmentIds, andreaMemberId } = await given();
    // Victor reads review 1 as himself: his own commitments, never Andrea's (SC-102).
    const own = await call("GET", `/seasons/${seasonId}/reviews/1`, "victor");
    expect(own.status).toBe(200);
    expect(own.json.data.commitments.map((c: { commitmentId: string }) => c.commitmentId)).toEqual([
      commitmentIds.victor,
    ]);
    expect(JSON.stringify(own.json)).not.toContain(commitmentIds.andrea);
    expect(JSON.stringify(own.json)).not.toContain(REFLECTION);
    // There is no peer-addressed review route at all.
    const addressed = await call(
      "GET",
      `/seasons/${seasonId}/members/${andreaMemberId}/reviews/1`,
      "victor",
    );
    expect([addressed.status, addressed.json.error.code]).toEqual([404, "RouteNotFound"]);
    // The stage of a peer's commitment is not found, the same as an unknown one.
    const stage = await call(
      "GET",
      `/seasons/${seasonId}/commitments/${commitmentIds.andrea}/stage`,
      "victor",
    );
    expect([stage.status, stage.json.error.code]).toEqual([404, "CommitmentNotFound"]);
  });

  it("SC-104: submitting reviews changes neither points nor standings", async () => {
    const ctx = await givenTwoMemberSeason();
    const { call, seasonId, commitmentIds } = ctx;
    const before = await call("GET", `/seasons/${seasonId}/standings`, "victor");
    await call("POST", `/seasons/${seasonId}/reviews/0`, "andrea", {
      reflection: { helped: REFLECTION, hard: null },
      automaticity: [{ commitmentId: commitmentIds.andrea, items: [1, 1, 1, 1] }],
    });
    const after = await call("GET", `/seasons/${seasonId}/standings`, "victor");
    expect(after.json).toEqual(before.json);
  });
});
