import { instant } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { givenTwoMemberSeason } from "./entries-fixture.ts";

// The season is 4 weeks long with cadence 1 and starts 2023-11-14 (day 1, America/Bogota), so:
// baseline offer days 1-7, review 1 (item 1 only) days 8-14, review 2 (full, mid-season) days 15-21.
const UNKNOWN = "cccccccc-0000-4000-8000-000000000000";
const at = (month: number, day: number) => instant(Date.UTC(2023, month - 1, day, 17));

async function given(when: [month: number, day: number] = [11, 14]) {
  const ctx = await givenTwoMemberSeason();
  ctx.setNow(at(...when));
  const reviews = `/seasons/${ctx.seasonId}/reviews`;
  const item1 = (who: "andrea" | "victor", score = 5) => ({
    reflection: { helped: null, hard: null },
    automaticity: [{ commitmentId: ctx.commitmentIds[who], items: [score, null, null, null] }],
  });
  const full = (who: "andrea" | "victor", items: (number | null)[] = [4, 4, 5, 5]) => ({
    reflection: { helped: "Calma", hard: null },
    automaticity: [{ commitmentId: ctx.commitmentIds[who], items }],
  });
  return { ...ctx, reviews, item1, full };
}

describe("401 on every review route", () => {
  it("rejects a missing token on all four", async () => {
    const { call, reviews, seasonId } = await given();
    const results = await Promise.all([
      call("GET", `${reviews}/1`, null),
      call("POST", `${reviews}/1`, null, {}),
      call("POST", `${reviews}/0/skip`, null),
      call("GET", `/seasons/${seasonId}/commitments/${UNKNOWN}/stage`, null),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401, 401]);
  });
});

describe("GET /seasons/:seasonId/reviews/:periodIndex", () => {
  it("200 the owner's draft with exactly the documented keys", async () => {
    const { call, reviews, commitmentIds } = await given([11, 21]);

    const res = await call("GET", `${reviews}/1`, "andrea");

    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      status: "due",
      kind: "interim",
      srbai: "item1",
      weeks: { first: 1, last: 1 },
      dueUntil: "2023-11-27",
      commitments: [{ commitmentId: commitmentIds.andrea, habitName: "Run andrea", paused: false }],
    });
    expect(res.json.data.summary).not.toBeNull();
    expect(Object.keys(res.json.data).sort()).toEqual([
      "commitments",
      "dueUntil",
      "kind",
      "srbai",
      "status",
      "summary",
      "weeks",
    ]);
    expect(Object.keys(res.json.data.summary).sort()).toEqual(["commitments", "final", "totals"]);
  });

  it("the baseline draft has no weeks and no summary", async () => {
    const { call, reviews } = await given();
    const res = await call("GET", `${reviews}/0`, "andrea");
    expect(res.status).toBe(200);
    expect(res.json.data).toMatchObject({
      kind: "baseline",
      srbai: "full",
      weeks: null,
      summary: null,
    });
  });

  it("the viewer's own commitments only: a peer's never appears", async () => {
    const { call, reviews, commitmentIds } = await given([11, 21]);
    const res = await call("GET", `${reviews}/1`, "victor");
    expect(res.json.data.commitments.map((c: { commitmentId: string }) => c.commitmentId)).toEqual([
      commitmentIds.victor,
    ]);
  });

  it("404 ReviewPeriodNotFound past the last period, 404 SeasonNotFound, 422 for a bad index", async () => {
    const { call, reviews } = await given([11, 21]);
    const past = await call("GET", `${reviews}/9`, "andrea");
    const unknown = await call("GET", `/seasons/${UNKNOWN}/reviews/1`, "andrea");
    const bad = await call("GET", `${reviews}/first`, "andrea");
    const negative = await call("GET", `${reviews}/-1`, "andrea");
    expect([past, unknown, bad, negative].map((r) => [r.status, r.json.error.code])).toEqual([
      [404, "ReviewPeriodNotFound"],
      [404, "SeasonNotFound"],
      [422, "InvalidRequest"],
      [422, "InvalidRequest"],
    ]);
  });

  it("reading writes nothing: the same read twice, then the review is still submittable", async () => {
    const { call, reviews, item1 } = await given([11, 21]);
    await call("GET", `${reviews}/1`, "andrea");
    await call("GET", `${reviews}/1`, "andrea");
    const res = await call("POST", `${reviews}/1`, "andrea", item1("andrea"));
    expect(res.status).toBe(201);
  });
});

describe("POST /seasons/:seasonId/reviews/:periodIndex", () => {
  it("201 completed with the improvements and the next review date", async () => {
    const { call, reviews, item1 } = await given([11, 21]);

    const res = await call("POST", `${reviews}/1`, "andrea", item1("andrea"));

    expect(res.status).toBe(201);
    expect(res.json.data).toEqual({
      status: "completed",
      improvements: [],
      nextReviewDate: "2023-11-28",
    });
  });

  it("names the commitments that feel more automatic than at the baseline (35b)", async () => {
    const { call, reviews, setNow, commitmentIds } = await given();
    const baseline = await call("POST", `${reviews}/0`, "andrea", {
      reflection: { helped: null, hard: null },
      automaticity: [{ commitmentId: commitmentIds.andrea, items: [3, 3, 3, 4] }],
    });
    expect(baseline.status).toBe(201);
    setNow(at(11, 28));

    const res = await call("POST", `${reviews}/2`, "andrea", {
      reflection: { helped: "  Con calma  ", hard: null },
      automaticity: [{ commitmentId: commitmentIds.andrea, items: [6, 6, 6, 6] }],
    });

    expect(res.status).toBe(201);
    expect(res.json.data.improvements).toEqual([
      { commitmentId: commitmentIds.andrea, from: "3,3", to: "6,0" },
    ]);
    expect(res.json.data.nextReviewDate).toBe("2023-12-05");
  });

  it("409 ReviewAlreadySubmitted on a second submit, 409 ReviewNotDue before and after the window", async () => {
    const { call, reviews, item1, setNow } = await given([11, 21]);
    const first = await call("POST", `${reviews}/1`, "andrea", item1("andrea"));
    const again = await call("POST", `${reviews}/1`, "andrea", item1("andrea", 2));
    const early = await call("POST", `${reviews}/2`, "andrea", item1("andrea"));
    setNow(at(11, 29));
    const lapsed = await call("POST", `${reviews}/1`, "victor", item1("victor"));
    expect(
      [first, again, early, lapsed].map((r) => [
        r.status,
        r.json.error?.code,
        r.json.error?.details,
      ]),
    ).toEqual([
      [201, undefined, undefined],
      [409, "ReviewAlreadySubmitted", undefined],
      [409, "ReviewNotDue", { reason: "notYet" }],
      [409, "ReviewNotDue", { reason: "lapsed" }],
    ]);
  });

  it("422 InvalidAutomaticity and AutomaticityIncomplete, with their details", async () => {
    const { call, reviews, setNow, commitmentIds, item1, full } = await given([11, 21]);
    const extraItem = await call("POST", `${reviews}/1`, "andrea", full("andrea"));
    const outOfRange = await call("POST", `${reviews}/1`, "andrea", item1("andrea", 8));
    const missing = await call("POST", `${reviews}/1`, "andrea", {
      reflection: { helped: null, hard: null },
      automaticity: [],
    });
    setNow(at(11, 28));
    const incomplete = await call(
      "POST",
      `${reviews}/2`,
      "andrea",
      full("andrea", [4, 4, null, 5]),
    );
    expect(
      [extraItem, outOfRange, missing, incomplete].map((r) => [
        r.status,
        r.json.error.code,
        r.json.error.details,
      ]),
    ).toEqual([
      [422, "InvalidAutomaticity", { commitmentId: commitmentIds.andrea }],
      [422, "InvalidAutomaticity", { commitmentId: commitmentIds.andrea }],
      [422, "AutomaticityIncomplete", { commitmentIds: [commitmentIds.andrea] }],
      [422, "AutomaticityIncomplete", { commitmentIds: [commitmentIds.andrea] }],
    ]);
  });

  it("403 for a peer's commitment, 422 for a body that is not the documented shape", async () => {
    const { call, reviews, commitmentIds, item1 } = await given([11, 21]);
    const foreign = await call("POST", `${reviews}/1`, "andrea", item1("victor"));
    const noReflection = await call("POST", `${reviews}/1`, "andrea", { automaticity: [] });
    const memberId = await call("POST", `${reviews}/1`, "andrea", {
      ...item1("andrea"),
      memberId: commitmentIds.victor,
    });
    const notNumber = await call("POST", `${reviews}/1`, "andrea", {
      reflection: { helped: null, hard: null },
      automaticity: [{ commitmentId: commitmentIds.andrea, items: ["5", null, null, null] }],
    });
    const longText = await call("POST", `${reviews}/1`, "andrea", {
      ...item1("andrea"),
      reflection: { helped: "x".repeat(5000), hard: null },
    });
    expect(
      [foreign, noReflection, memberId, notNumber, longText].map((r) => [
        r.status,
        r.json.error.code,
      ]),
    ).toEqual([
      [403, "CommitmentNotOwned"],
      [422, "InvalidRequest"],
      [422, "InvalidRequest"],
      [422, "InvalidRequest"],
      [422, "NoteTooLong"],
    ]);
  });

  it("404 ReviewPeriodNotFound for a period past the end", async () => {
    const { call, reviews, item1 } = await given([11, 21]);
    const res = await call("POST", `${reviews}/9`, "andrea", item1("andrea"));
    expect([res.status, res.json.error.code]).toEqual([404, "ReviewPeriodNotFound"]);
  });
});

describe("POST /seasons/:seasonId/reviews/:periodIndex/skip", () => {
  it("200 skipped for the baseline, then 409 ReviewAlreadySubmitted and no offer", async () => {
    const { call, reviews, seasonId } = await given();
    const first = await call("POST", `${reviews}/0/skip`, "andrea");
    const again = await call("POST", `${reviews}/0/skip`, "andrea");
    const submit = await call("POST", `${reviews}/0`, "andrea", {
      reflection: { helped: null, hard: null },
      automaticity: [],
    });
    const today = await call("GET", "/me/today", "andrea");
    expect([first, again, submit].map((r) => [r.status, r.json.data ?? r.json.error.code])).toEqual(
      [
        [200, { status: "skipped" }],
        [409, "ReviewAlreadySubmitted"],
        [409, "ReviewAlreadySubmitted"],
      ],
    );
    expect(today.json.data.baselineOffer).toBeNull();
    expect(seasonId).toBeTruthy();
  });

  it("409 ReviewNotSkippable for a periodic review, 409 ReviewNotDue once the offer lapsed", async () => {
    const { call, reviews, setNow } = await given([11, 21]);
    const periodic = await call("POST", `${reviews}/1/skip`, "andrea");
    const lapsed = await call("POST", `${reviews}/0/skip`, "andrea");
    setNow(at(11, 14));
    expect([periodic, lapsed].map((r) => [r.status, r.json.error.code])).toEqual([
      [409, "ReviewNotSkippable"],
      [409, "ReviewNotDue"],
    ]);
  });

  it("a skip takes no body", async () => {
    const { call, reviews } = await given();
    const res = await call("POST", `${reviews}/0/skip`, "andrea", { memberId: UNKNOWN });
    expect([res.status, res.json.error.code]).toEqual([422, "InvalidRequest"]);
  });
});

describe("GET /seasons/:seasonId/commitments/:commitmentId/stage", () => {
  it("200 for the owner: only the commitment and its stage", async () => {
    const { call, seasonId, commitmentIds } = await given();
    const res = await call(
      "GET",
      `/seasons/${seasonId}/commitments/${commitmentIds.andrea}/stage`,
      "andrea",
    );
    expect([res.status, res.json.data]).toEqual([
      200,
      { commitmentId: commitmentIds.andrea, stage: "new" },
    ]);
  });

  it("404 CommitmentNotFound for a peer and for an unknown commitment (SC-101)", async () => {
    const { call, seasonId, commitmentIds } = await given();
    const peer = await call(
      "GET",
      `/seasons/${seasonId}/commitments/${commitmentIds.andrea}/stage`,
      "victor",
    );
    const unknown = await call(
      "GET",
      `/seasons/${seasonId}/commitments/${UNKNOWN}/stage`,
      "victor",
    );
    expect([peer, unknown].map((r) => [r.status, r.json.error.code])).toEqual([
      [404, "CommitmentNotFound"],
      [404, "CommitmentNotFound"],
    ]);
  });
});
