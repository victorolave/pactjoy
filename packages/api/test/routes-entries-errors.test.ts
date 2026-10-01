import { deleteEntry, entryId } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { DONE_BODY, givenActiveSeason, MINUTES } from "./entries-fixture.ts";
import { ANDREA, UNKNOWN_CIRCLE, VICTOR } from "./harness.ts";

describe("POST /seasons/:seasonId/entries: app errors (UE-E-S3, S5, S6)", () => {
  it("S3: the same clientRequestId with another note is 422 IdempotencyKeyReused", async () => {
    const { call, path, commitmentId } = await givenActiveSeason();
    await call("POST", path, "andrea", { commitmentId, ...DONE_BODY });
    const { status, json } = await call("POST", path, "andrea", {
      commitmentId,
      ...DONE_BODY,
      note: "different",
    });
    expect([status, json.error.code]).toEqual([422, "IdempotencyKeyReused"]);
  });

  it.each([
    ["empty", "", "empty"],
    ["129 characters", "k".repeat(129), "tooLong"],
    ["a NUL character", "a\u0000b", "malformed"],
  ])(
    "RV-S21: clientRequestId %s is 422 InvalidClientRequestId (%s)",
    async (_label, key, reason) => {
      const { call, path, commitmentId } = await givenActiveSeason();
      const { status, json } = await call("POST", path, "andrea", {
        commitmentId,
        value: { kind: "done" },
        clientRequestId: key,
      });
      expect([status, json.error.code]).toEqual([422, "InvalidClientRequestId"]);
      expect(json.error.details.reason).toBe(reason);
    },
  );

  it("S6: ValueKindMismatch, InvalidQuantity and NoteTooLong map to 422", async () => {
    const { call, path, commitmentId } = await givenActiveSeason(MINUTES);
    const send = (value: object, extra: object = {}) =>
      call("POST", path, "andrea", { commitmentId, value, clientRequestId: "k", ...extra });
    const mismatch = await send({ kind: "done" });
    expect([mismatch.status, mismatch.json.error.code]).toEqual([422, "ValueKindMismatch"]);
    const negative = await send({ kind: "quantity", value: "-1" });
    expect([negative.status, negative.json.error.code]).toEqual([422, "InvalidQuantity"]);
    expect(negative.json.error.details.reason).toBe("negative");
    const long = await send({ kind: "quantity", value: "5" }, { note: "x".repeat(281) });
    expect([long.status, long.json.error.code]).toEqual([422, "NoteTooLong"]);
  });

  it("S6: a missed entry on a limit commitment is 422 MissedNotAllowed", async () => {
    const limit = {
      unit: "glasses",
      direction: "limit",
      ideal: "2",
      tolerance: "4",
      schedule: { period: "perSession", frequency: { kind: "timesPerWeek", times: 3 } },
    };
    const { call, path, commitmentId } = await givenActiveSeason(limit);
    const { status, json } = await call("POST", path, "andrea", {
      commitmentId,
      value: { kind: "missed" },
      clientRequestId: "k",
    });
    expect([status, json.error.code]).toEqual([422, "MissedNotAllowed"]);
  });

  it("S5: FutureDay and BeforeSeasonStart are 409", async () => {
    const { call, path, commitmentId } = await givenActiveSeason();
    const send = (forDate: string) =>
      call("POST", path, "andrea", { commitmentId, ...DONE_BODY, forDate });
    const future = await send("2023-11-15");
    expect([future.status, future.json.error.code]).toEqual([409, "FutureDay"]);
    const before = await send("2023-11-13");
    expect([before.status, before.json.error.code]).toEqual([409, "BeforeSeasonStart"]);
  });

  it("S5: WindowClosed (grace period) is 409 and a day past the season is 422 OutsideSeason", async () => {
    const ctx = await givenActiveSeason();
    const season = await ctx.app.seasons.get(ctx.seasonId as never);
    if (!season) throw new Error("fixture setup failed");
    // Started 44 days ago: week 0's grace (end of day 7) is long gone and today is past week 4.
    const old = { ...season, actualStart: "2023-10-01" as never, version: 99 };
    await ctx.app.seasons.save(old, season.version);
    const send = (extra: object) =>
      ctx.call("POST", ctx.path, "andrea", {
        commitmentId: ctx.commitmentId,
        ...DONE_BODY,
        ...extra,
      });
    const closed = await send({ forDate: "2023-10-01" });
    expect([closed.status, closed.json.error.code]).toEqual([409, "WindowClosed"]);
    const outside = await send({});
    expect([outside.status, outside.json.error.code]).toEqual([422, "OutsideSeason"]);
  });

  it("S5: a non-member is 403 NotAMember and no user id is echoed", async () => {
    const ctx = await givenActiveSeason();
    const stranger = await ctx.call("POST", ctx.path, "victor", {
      commitmentId: ctx.commitmentId,
      ...DONE_BODY,
    });
    expect([stranger.status, stranger.json.error.code]).toEqual([403, "NotAMember"]);
    expect(JSON.stringify(stranger.json)).not.toContain(VICTOR);
  });

  it("S5: a commitment that is not the caller's is 403 CommitmentNotOwned", async () => {
    const ctx = await givenActiveSeason();
    const res = await ctx.call("POST", ctx.path, "andrea", {
      commitmentId: UNKNOWN_CIRCLE,
      ...DONE_BODY,
    });
    expect([res.status, res.json.error.code]).toEqual([403, "CommitmentNotOwned"]);
  });

  it("404 SeasonNotFound and 409 SeasonNotActive map through", async () => {
    const ctx = await givenActiveSeason();
    const missing = await ctx.call("POST", `/seasons/${UNKNOWN_CIRCLE}/entries`, "andrea", {
      commitmentId: ctx.commitmentId,
      ...DONE_BODY,
    });
    expect([missing.status, missing.json.error.code]).toEqual([404, "SeasonNotFound"]);
    const season = await ctx.app.seasons.get(ctx.seasonId as never);
    if (!season) throw new Error("fixture setup failed");
    await ctx.app.seasons.save({ ...season, status: "pactOpen", version: 99 }, season.version);
    const inactive = await ctx.call("POST", ctx.path, "andrea", {
      commitmentId: ctx.commitmentId,
      ...DONE_BODY,
    });
    expect([inactive.status, inactive.json.error.code]).toEqual([409, "SeasonNotActive"]);
  });

  it("S4: replaying the key of a deleted entry is 409 EntryDeleted and nothing is recreated", async () => {
    const ctx = await givenActiveSeason();
    const body = { commitmentId: ctx.commitmentId, ...DONE_BODY };
    const first = await ctx.call("POST", ctx.path, "andrea", body);
    const deleted = await deleteEntry(
      ctx.app,
      { userId: ANDREA },
      { entryId: entryId(first.json.data.entry.id) },
    );
    expect(deleted.ok).toBe(true);
    const again = await ctx.call("POST", ctx.path, "andrea", body);
    expect([again.status, again.json.error.code]).toEqual([409, "EntryDeleted"]);
    const rows = await ctx.app.entries.listBySeason(ctx.seasonId as never);
    expect(rows).toHaveLength(0);
  });

  it("T1: a replay after its window closed is still 200 with the original entry", async () => {
    const ctx = await givenActiveSeason();
    const body = { commitmentId: ctx.commitmentId, ...DONE_BODY };
    const first = await ctx.call("POST", ctx.path, "andrea", body);
    const season = await ctx.app.seasons.get(ctx.seasonId as never);
    if (!season) throw new Error("fixture setup failed");
    // Started 44 days ago: the entry's day-0 window is long closed.
    const old = { ...season, actualStart: "2023-10-01" as never, version: 99 };
    await ctx.app.seasons.save(old, season.version);
    const again = await ctx.call("POST", ctx.path, "andrea", body);
    expect(again.status).toBe(200);
    expect(again.json.data.replayed).toBe(true);
    expect(again.json.data.entry.id).toBe(first.json.data.entry.id);
  });
});
