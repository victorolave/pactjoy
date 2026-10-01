import { describe, expect, it } from "vitest";
import { DONE_BODY, givenActiveSeason, MINUTES } from "./entries-fixture.ts";

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

  it("the viewer MemberId comes from a circle read, not from the entry (#5040)", async () => {
    const { call, path, commitmentId, read, app } = await givenActiveSeason();
    const reads = read.mock.calls.length;
    const { json } = await call("POST", path, "andrea", { commitmentId, ...DONE_BODY });
    expect(read.mock.calls.length).toBe(reads + 1);
    const circle = await app.circles.findActiveByUser(
      "aaaaaaaa-0000-4000-8000-000000000001" as never,
    );
    expect(json.data.entry.memberId).toBe(circle?.members[0]?.id);
  });

  it("an entry that is not the viewer's own is never presented: 500 Internal, no note leaked", async () => {
    const { call, path, commitmentId, read, app } = await givenActiveSeason();
    const circle = await app.circles.findActiveByUser(
      "aaaaaaaa-0000-4000-8000-000000000001" as never,
    );
    const other = { ...circle, members: [{ ...circle?.members[0], id: "m-someone-else" }] };
    read.mockImplementationOnce(async (work) =>
      work({ circles: { findActiveByUser: async () => other } } as never),
    );
    const { status, json } = await call("POST", path, "andrea", {
      commitmentId,
      ...DONE_BODY,
      note: "private words",
    });
    expect([status, json.error.code]).toEqual([500, "Internal"]);
    expect(JSON.stringify(json)).not.toContain("private words");
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
