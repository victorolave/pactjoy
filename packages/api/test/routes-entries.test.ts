import { describe, expect, it } from "vitest";
import { DONE_BODY, givenActiveSeason, givenTwoMemberSeason, MINUTES } from "./entries-fixture.ts";
import { ANDREA, VICTOR } from "./harness.ts";

describe("POST /seasons/:seasonId/entries (UE-E-S1..S6)", () => {
  it("S1: 201 replayed:false, no requestFingerprint, no userId", async () => {
    const { call, path, commitmentId } = await givenActiveSeason();
    const { status, json } = await call("POST", path, "andrea", { commitmentId, ...DONE_BODY });
    expect(status).toBe(201);
    expect(json.data.replayed).toBe(false);
    expect(json.data.entry).toMatchObject({
      commitmentId,
      value: { kind: "done" },
      note: null,
      clientRequestId: "req-1",
      deleted: false,
    });
    expect(Object.keys(json.data.entry)).not.toContain("requestFingerprint");
    expect(JSON.stringify(json)).not.toContain("aaaaaaaa-0000-4000-8000-000000000001");
  });

  it("the presented memberId is the acting member's, not the circle owner's (two members)", async () => {
    const { call, path, commitmentIds, app, circleId } = await givenTwoMemberSeason();
    const circle = await app.circles.get(circleId as never);
    const memberOf = (user: string) => circle?.members.find((m) => m.userId === user)?.id;
    const body = (who: "andrea" | "victor") => ({
      commitmentId: commitmentIds[who],
      ...DONE_BODY,
    });

    const victor = await call("POST", path, "victor", body("victor"));
    const replay = await call("POST", path, "victor", body("victor"));
    const andrea = await call("POST", path, "andrea", body("andrea"));

    expect(victor.status).toBe(201);
    expect(victor.json.data.entry.memberId).toBe(memberOf(VICTOR));
    expect([replay.status, replay.json.data.entry.memberId]).toEqual([200, memberOf(VICTOR)]);
    expect(andrea.json.data.entry.memberId).toBe(memberOf(ANDREA));
    expect(memberOf(VICTOR)).not.toBe(memberOf(ANDREA));
  });

  it("a member who left gets 403 NotAMember, never a 500", async () => {
    const { call, path, commitmentIds, circleId } = await givenTwoMemberSeason();
    await call("POST", `/circles/${circleId}/leave`, "victor");
    const { status, json } = await call("POST", path, "victor", {
      commitmentId: commitmentIds.victor,
      ...DONE_BODY,
    });
    expect([status, json.error.code]).toEqual([403, "NotAMember"]);
  });

  it("S2: the same request again is 200 replayed:true with the same entry id", async () => {
    const { call, path, commitmentId } = await givenActiveSeason();
    const first = await call("POST", path, "andrea", { commitmentId, ...DONE_BODY });
    const again = await call("POST", path, "andrea", { commitmentId, ...DONE_BODY });
    expect(again.status).toBe(200);
    expect(again.json.data.replayed).toBe(true);
    expect(again.json.data.entry.id).toBe(first.json.data.entry.id);
  });

  it("quantity values are decimal strings and the note is kept (RV-S22)", async () => {
    const { call, path, commitmentId } = await givenActiveSeason(MINUTES);
    const { status, json } = await call("POST", path, "andrea", {
      commitmentId,
      value: { kind: "quantity", value: "7.5" },
      note: "easy run",
      clientRequestId: "req-2",
    });
    expect(status).toBe(201);
    expect(json.data.entry.value).toEqual({ kind: "quantity", value: "7.5" });
    expect(json.data.entry.note).toBe("easy run");
  });

  it("the member is never taken from the body: a memberId field is an unknownField", async () => {
    const { call, path, commitmentId, transaction } = await givenActiveSeason();
    const before = transaction.mock.calls.length;
    const res = await call("POST", path, "andrea", {
      commitmentId,
      ...DONE_BODY,
      memberId: "bbbbbbbb-0000-4000-8000-000000000009",
    });
    expect([res.status, res.json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(res.json.error.details.issues[0]).toEqual({ path: "memberId", problem: "unknownField" });
    expect(transaction.mock.calls.length).toBe(before);
  });

  it("422 with no repository call: bad ids, value shapes, forDate, key type, query-string key", async () => {
    const { call, path, commitmentId, transaction } = await givenActiveSeason();
    const before = transaction.mock.calls.length;
    const bodies: [string, object][] = [
      ["bad commitmentId", { commitmentId: "nope", ...DONE_BODY }],
      ["missing value", { commitmentId, clientRequestId: "k" }],
      ["unknown value kind", { commitmentId, value: { kind: "skipped" }, clientRequestId: "k" }],
      [
        "numeric quantity (no float)",
        { commitmentId, value: { kind: "quantity", value: 7.5 }, clientRequestId: "k" },
      ],
      ["bad forDate", { commitmentId, ...DONE_BODY, forDate: "2023-02-30" }],
      ["non-string key", { commitmentId, value: { kind: "done" }, clientRequestId: 5 }],
      ["missing key", { commitmentId, value: { kind: "done" } }],
      ["non-string note", { commitmentId, ...DONE_BODY, note: 5 }],
    ];
    for (const [label, body] of bodies) {
      const res = await call("POST", path, "andrea", body);
      expect([label, res.status, res.json.error.code]).toEqual([label, 422, "InvalidRequest"]);
    }
    const badSeason = await call("POST", "/seasons/nope/entries", "andrea", {
      commitmentId,
      ...DONE_BODY,
    });
    expect(badSeason.status).toBe(422);
    // UE-E-S16: the key lives in the body; a query string cannot supply it.
    const query = await call("POST", `${path}?clientRequestId=q`, "andrea", {
      commitmentId,
      value: { kind: "done" },
    });
    expect([query.status, query.json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(transaction.mock.calls.length).toBe(before);
  });

  it("401 without a token", async () => {
    const { call, path, commitmentId } = await givenActiveSeason();
    const { status, json } = await call("POST", path, null, { commitmentId, ...DONE_BODY });
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
  });
});
