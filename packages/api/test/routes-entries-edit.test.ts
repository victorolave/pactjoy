import { deleteEntry, entryId } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { givenActiveSeason, givenTwoMemberSeason, MINUTES } from "./entries-fixture.ts";
import { ANDREA, UNKNOWN_CIRCLE, VICTOR } from "./harness.ts";

/** An active minutes season with one entry recorded by Andrea (30 min, note "first"). */
async function givenRecorded() {
  const ctx = await givenActiveSeason(MINUTES);
  const recorded = await ctx.call("POST", ctx.path, "andrea", {
    commitmentId: ctx.commitmentId,
    value: { kind: "quantity", value: "30" },
    note: "first",
    clientRequestId: "req-1",
  });
  const id: string = recorded.json.data.entry.id;
  return { ...ctx, id, url: `/entries/${id}` };
}

const NEW = { value: { kind: "quantity", value: "45" }, note: "second" };

describe("PUT /entries/:entryId (UE-E-S8, S9)", () => {
  it("S8: 200, the new value and note, editedAt set, version bumped, no fingerprint", async () => {
    const { call, url, id } = await givenRecorded();
    const { status, json } = await call("PUT", url, "andrea", NEW);
    expect(status).toBe(200);
    expect(json.data.entry).toMatchObject({
      id,
      value: { kind: "quantity", value: "45" },
      note: "second",
      version: 1,
      deleted: false,
    });
    expect(json.data.entry.editedAt).toMatch(/^2023-11-14T/);
    expect(Object.keys(json.data)).toEqual(["entry"]);
    expect(Object.keys(json.data.entry)).not.toContain("requestFingerprint");
    expect(JSON.stringify(json)).not.toContain(ANDREA);
  });

  it("S8: an edit that changes nothing is 200 and leaves version and editedAt alone", async () => {
    const { call, url } = await givenRecorded();
    const { status, json } = await call("PUT", url, "andrea", {
      value: { kind: "quantity", value: "30" },
      note: "first",
    });
    expect(status).toBe(200);
    expect(json.data.entry).toMatchObject({ version: 0, editedAt: null });
  });

  it("S9: note null clears the note", async () => {
    const { call, url } = await givenRecorded();
    const { status, json } = await call("PUT", url, "andrea", { ...NEW, note: null });
    expect([status, json.data.entry.note]).toEqual([200, null]);
  });

  it("S9: an omitted note is 422 InvalidRequest and no repository call is made", async () => {
    const { call, url, transaction } = await givenRecorded();
    const before = transaction.mock.calls.length;
    const { status, json } = await call("PUT", url, "andrea", { value: NEW.value });
    expect([status, json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(json.error.details.issues[0]).toEqual({ path: "note", problem: "required" });
    expect(transaction.mock.calls.length).toBe(before);
  });

  it("422 with no repository call: bad id, value shapes, note type, fields that are not editable", async () => {
    const { call, url, transaction } = await givenRecorded();
    const before = transaction.mock.calls.length;
    const bodies: [string, string, object][] = [
      ["bad entry id", "/entries/nope", NEW],
      ["upper-case entry id", `/entries/${UNKNOWN_CIRCLE.toUpperCase()}`, NEW],
      ["missing value", url, { note: null }],
      ["unknown value kind", url, { value: { kind: "skipped" }, note: null }],
      ["numeric quantity (no float)", url, { value: { kind: "quantity", value: 7.5 }, note: null }],
      ["non-string note", url, { value: NEW.value, note: 5 }],
      ["memberId", url, { ...NEW, memberId: UNKNOWN_CIRCLE }],
      ["clientRequestId", url, { ...NEW, clientRequestId: "other" }],
      ["forDate", url, { ...NEW, forDate: "2023-11-14" }],
    ];
    for (const [label, path, body] of bodies) {
      const res = await call("PUT", path, "andrea", body);
      expect([label, res.status, res.json.error.code]).toEqual([label, 422, "InvalidRequest"]);
    }
    expect(transaction.mock.calls.length).toBe(before);
  });

  it("app errors map: ValueKindMismatch and NoteTooLong 422, EntryNotFound 404", async () => {
    const { call, url } = await givenRecorded();
    const mismatch = await call("PUT", url, "andrea", { value: { kind: "done" }, note: null });
    expect([mismatch.status, mismatch.json.error.code]).toEqual([422, "ValueKindMismatch"]);
    const long = await call("PUT", url, "andrea", { ...NEW, note: "x".repeat(281) });
    expect([long.status, long.json.error.code]).toEqual([422, "NoteTooLong"]);
    const missing = await call("PUT", `/entries/${UNKNOWN_CIRCLE}`, "andrea", NEW);
    expect([missing.status, missing.json.error.code]).toEqual([404, "EntryNotFound"]);
  });

  it("app errors map: WindowClosed 409 once the grace is gone, EntryDeleted 409 after a delete", async () => {
    const ctx = await givenRecorded();
    const deleted = await givenRecorded();
    await deleteEntry(deleted.app, { userId: ANDREA }, { entryId: entryId(deleted.id) });
    const gone = await deleted.call("PUT", deleted.url, "andrea", NEW);
    expect([gone.status, gone.json.error.code]).toEqual([409, "EntryDeleted"]);

    const season = await ctx.app.seasons.get(ctx.seasonId as never);
    if (!season) throw new Error("fixture setup failed");
    const old = { ...season, actualStart: "2023-10-01" as never, version: 99 };
    await ctx.app.seasons.save(old, season.version);
    // Shifted start: the entry (day 0) is now 44 days old and its grace is long gone.
    const closed = await ctx.call("PUT", ctx.url, "andrea", NEW);
    expect([closed.status, closed.json.error.code]).toEqual([409, "WindowClosed"]);
  });

  it("a caller who is not in the circle is 403 NotAMember, never the entry", async () => {
    const { call, url } = await givenRecorded();
    const { status, json } = await call("PUT", url, "victor", NEW);
    expect([status, json.error.code]).toEqual([403, "NotAMember"]);
    expect(JSON.stringify(json)).not.toContain("first");
    expect(JSON.stringify(json)).not.toContain(VICTOR);
  });

  it("401 without a token", async () => {
    const { call, url } = await givenRecorded();
    const { status, json } = await call("PUT", url, null, NEW);
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
  });

  it("the presented memberId is the editor's own (two members), and another member's entry is never editable or shown", async () => {
    const { call, path, commitmentIds, app, circleId } = await givenTwoMemberSeason();
    const circle = await app.circles.get(circleId as never);
    const memberOf = (user: string) => circle?.members.find((m) => m.userId === user)?.id;
    const record = (who: "andrea" | "victor", note: string) =>
      call("POST", path, who, {
        commitmentId: commitmentIds[who],
        value: { kind: "done" },
        note,
        clientRequestId: `req-${who}`,
      });
    const andrea = await record("andrea", "andrea-secret");
    const victor = await record("victor", "victor-secret");

    const own = await call("PUT", `/entries/${victor.json.data.entry.id}`, "victor", {
      value: { kind: "done" },
      note: "edited",
    });
    expect(own.status).toBe(200);
    expect(own.json.data.entry.memberId).toBe(memberOf(VICTOR));

    const foreign = await call("PUT", `/entries/${andrea.json.data.entry.id}`, "victor", {
      value: { kind: "done" },
      note: "hijack",
    });
    expect([foreign.status, foreign.json.error.code]).toEqual([403, "EntryNotOwned"]);
    expect(JSON.stringify(foreign.json)).not.toContain("andrea-secret");
    const stored = await app.entries.get(andrea.json.data.entry.id);
    expect(stored).toMatchObject({ note: "andrea-secret", version: 0 });
  });
});
