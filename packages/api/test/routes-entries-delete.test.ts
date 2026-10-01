import { describe, expect, it } from "vitest";
import { givenActiveSeason, givenTwoMemberSeason } from "./entries-fixture.ts";
import { ANDREA, UNKNOWN_CIRCLE } from "./harness.ts";

/** An active season with one entry recorded by Andrea (note "private words"). */
async function givenRecorded() {
  const ctx = await givenActiveSeason();
  const recorded = await ctx.call("POST", ctx.path, "andrea", {
    commitmentId: ctx.commitmentId,
    value: { kind: "done" },
    note: "private words",
    clientRequestId: "req-1",
  });
  const id: string = recorded.json.data.entry.id;
  return { ...ctx, id, url: `/entries/${id}` };
}

describe("DELETE /entries/:entryId (UE-E-S10)", () => {
  it("S10: 200 {data:null}, the entry is gone, and a second delete is 200 again", async () => {
    const { call, url, app, seasonId, id } = await givenRecorded();
    const first = await call("DELETE", url, "andrea");
    expect([first.status, first.json]).toEqual([200, { data: null }]);
    expect(await app.entries.listBySeason(seasonId as never)).toHaveLength(0);
    expect(await app.entries.getStored(id as never)).toMatchObject({ deleted: true });
    const second = await call("DELETE", url, "andrea");
    expect([second.status, second.json]).toEqual([200, { data: null }]);
  });

  it("a deleted key is never recreated: the same record request is 409 EntryDeleted", async () => {
    const { call, url, path, commitmentId } = await givenRecorded();
    await call("DELETE", url, "andrea");
    const again = await call("POST", path, "andrea", {
      commitmentId,
      value: { kind: "done" },
      note: "private words",
      clientRequestId: "req-1",
    });
    expect([again.status, again.json.error.code]).toEqual([409, "EntryDeleted"]);
  });

  it("422 with no repository call: a bad or upper-case entry id, or a body", async () => {
    const { call, transaction } = await givenRecorded();
    const before = transaction.mock.calls.length;
    for (const path of ["/entries/nope", `/entries/${UNKNOWN_CIRCLE.toUpperCase()}`]) {
      const res = await call("DELETE", path, "andrea");
      expect([path, res.status, res.json.error.code]).toEqual([path, 422, "InvalidRequest"]);
    }
    const withBody = await call("DELETE", `/entries/${UNKNOWN_CIRCLE}`, "andrea", { x: 1 });
    expect([withBody.status, withBody.json.error.code]).toEqual([422, "InvalidRequest"]);
    expect(withBody.json.error.details).toEqual({ reason: "bodyNotAllowed" });
    expect(transaction.mock.calls.length).toBe(before);
  });

  it("app errors map: unknown id 404, closed window 409, non-member 403 without echoing the note", async () => {
    const ctx = await givenRecorded();
    const missing = await ctx.call("DELETE", `/entries/${UNKNOWN_CIRCLE}`, "andrea");
    expect([missing.status, missing.json.error.code]).toEqual([404, "EntryNotFound"]);

    const stranger = await ctx.call("DELETE", ctx.url, "victor");
    expect([stranger.status, stranger.json.error.code]).toEqual([403, "NotAMember"]);
    expect(JSON.stringify(stranger.json)).not.toContain("private words");

    const season = await ctx.app.seasons.get(ctx.seasonId as never);
    if (!season) throw new Error("fixture setup failed");
    // version 99 is arbitrary: any value differing from season.version proves the stored copy was replaced (the save is guarded by the expected version).
    const old = { ...season, actualStart: "2023-10-01" as never, version: 99 };
    await ctx.app.seasons.save(old, season.version);
    const closed = await ctx.call("DELETE", ctx.url, "andrea");
    expect([closed.status, closed.json.error.code]).toEqual([409, "WindowClosed"]);
  });

  it("401 without a token", async () => {
    const { call, url } = await givenRecorded();
    const { status, json } = await call("DELETE", url, null);
    expect([status, json.error.code]).toEqual([401, "Unauthorized"]);
  });
});

describe("own entries only (UE-E-S15)", () => {
  it("no member can edit or delete another member's entry or see its note, whoever acts", async () => {
    const { call, path, commitmentIds, app } = await givenTwoMemberSeason();
    const entries = new Map<"andrea" | "victor", string>();
    for (const who of ["andrea", "victor"] as const) {
      const res = await call("POST", path, who, {
        commitmentId: commitmentIds[who],
        value: { kind: "done" },
        note: `${who}-secret`,
        clientRequestId: `req-${who}`,
      });
      entries.set(who, res.json.data.entry.id);
    }

    for (const [actor, owner] of [
      ["victor", "andrea"],
      ["andrea", "victor"],
    ] as const) {
      const url = `/entries/${entries.get(owner)}`;
      const edit = await call("PUT", url, actor, { value: { kind: "done" }, note: "hijack" });
      const remove = await call("DELETE", url, actor);
      for (const res of [edit, remove]) {
        expect([actor, res.status, res.json.error.code]).toEqual([actor, 403, "EntryNotOwned"]);
        expect(JSON.stringify(res.json)).not.toContain(`${owner}-secret`);
      }
      const stored = await app.entries.getStored(entries.get(owner) as never);
      expect(stored).toMatchObject({ note: `${owner}-secret`, version: 0, deleted: false });
    }
    // The owners can still act on their own entries.
    const own = await call("DELETE", `/entries/${entries.get("victor")}`, "victor");
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.json)).not.toContain(ANDREA);
  });
});
