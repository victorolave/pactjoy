import { describe, expect, it } from "vitest";
import { givenTwoMemberSeason } from "./entries-fixture.ts";
import { setup } from "./harness.ts";

// The season is 4 weeks long and starts 2023-11-14 (day 1, America/Bogota). The harness clock sits
// on day 1; `day(n)` moves it to noon of season day n. Week 1 turns final after day 8 (grace).
const day = (n: number) => Date.UTC(2023, 10, 13 + n, 17);
const UNKNOWN = "cccccccc-0000-4000-8000-000000000000";

type Who = "andrea" | "victor";

async function given() {
  const ctx = await givenTwoMemberSeason();
  const { call, setNow, commitmentIds } = ctx;
  const circle = await call("GET", "/me/circle", "victor");
  const andreaMemberId: string = circle.json.data.circle.members.find(
    (m: { isYou: boolean }) => !m.isYou,
  ).id;
  const victorMemberId: string = circle.json.data.circle.members.find(
    (m: { isYou: boolean }) => m.isYou,
  ).id;
  /** Logs a `done` entry on season day `n`. */
  const log = async (who: Who, n: number) => {
    setNow(day(n) as never);
    const res = await call("POST", ctx.path, who, {
      commitmentId: commitmentIds[who],
      value: { kind: "done" },
      clientRequestId: `${who}-${n}`,
    });
    expect([who, n, res.status]).toEqual([who, n, 201]);
  };
  const sessionKey = (who: Who, n: number) => `session:${commitmentIds[who]}:${n}`;
  const reactionPath = (key: string) =>
    `/seasons/${ctx.seasonId}/feed/${encodeURIComponent(key)}/reaction`;
  return { ...ctx, andreaMemberId, victorMemberId, log, sessionKey, reactionPath };
}

describe("401 on every social route", () => {
  it("rejects a missing token on all six", async () => {
    const { call, seasonId } = await given();
    const results = await Promise.all([
      call("GET", "/me/feed", null),
      call("GET", "/me/feed/after/abc", null),
      call("PUT", `/seasons/${seasonId}/feed/x/reaction`, null, { emoji: "fire" }),
      call("DELETE", `/seasons/${seasonId}/feed/x/reaction`, null),
      call("POST", `/seasons/${seasonId}/encouragements`, null, {}),
      call("POST", `/seasons/${seasonId}/nudge-dismissals`, null, {}),
    ]);
    expect(results.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401]);
  });
});

describe("GET /me/feed", () => {
  it("200 an empty feed for a caller with no circle", async () => {
    const { call } = setup();
    const res = await call("GET", "/me/feed", "andrea");
    expect([res.status, res.json.data]).toEqual([
      200,
      { seasonId: null, members: [], items: [], nextCursor: null, nudge: null },
    ]);
  });

  it("200 the documented shape: members without user ids, items newest first", async () => {
    const { call, log, seasonId, commitmentIds, andreaMemberId } = await given();
    await log("andrea", 1);

    const res = await call("GET", "/me/feed", "victor");

    expect(res.status).toBe(200);
    expect(Object.keys(res.json.data).sort()).toEqual([
      "items",
      "members",
      "nextCursor",
      "nudge",
      "seasonId",
    ]);
    expect(res.json.data.seasonId).toBe(seasonId);
    expect(res.json.data.nextCursor).toBeNull();
    expect(res.json.data.nudge).toBeNull();
    expect(res.json.data.members.map((m: object) => Object.keys(m).sort())).toEqual([
      ["displayName", "id", "isYou", "left"],
      ["displayName", "id", "isYou", "left"],
    ]);
    const completed = res.json.data.items.find((i: { kind: string }) => i.kind === "completed");
    expect(completed).toEqual({
      key: `session:${commitmentIds.andrea}:1`,
      kind: "completed",
      onDate: "2023-11-14",
      at: new Date(day(1)).toISOString(),
      memberId: andreaMemberId,
      subject: { kind: "habit", name: "Run andrea", icon: null },
      value: null,
      reactions: {
        counts: { heart: 0, raisedHands: 0, fire: 0, clap: 0 },
        mine: null,
        reactable: true,
      },
    });
    const start = res.json.data.items.find((i: { kind: string }) => i.kind === "seasonStarted");
    expect(start).toEqual({
      key: `season-start:${seasonId}`,
      kind: "seasonStarted",
      onDate: "2023-11-14",
      at: null,
      lengthWeeks: 4,
    });
  });
});

describe("GET /me/feed/after/:cursor", () => {
  it("pages without overlap, and only the first page carries the nudge", async () => {
    const { call, log } = await given();
    for (let n = 1; n <= 22; n++) await log("victor", n);

    const first = await call("GET", "/me/feed", "andrea");
    expect(first.json.data.items).toHaveLength(20);
    const cursor: string = first.json.data.nextCursor;
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);

    const second = await call("GET", `/me/feed/after/${cursor}`, "andrea");
    expect(second.status).toBe(200);
    expect(second.json.data.nudge).toBeNull();
    expect(second.json.data.nextCursor).toBeNull();
    const keys = [...first.json.data.items, ...second.json.data.items].map(
      (i: { key: string }) => i.key,
    );
    expect(new Set(keys).size).toBe(keys.length);
    // 22 sessions, the two closed consistent weeks and the season start.
    expect(keys).toHaveLength(25);
    expect(keys.filter((k: string) => k.startsWith("session:"))).toHaveLength(22);
  });

  it("422 InvalidFeedCursor for a cursor that is not ours", async () => {
    const { call } = await given();
    const res = await call("GET", "/me/feed/after/AAAA", "victor");
    expect([res.status, res.json.error.code]).toEqual([422, "InvalidFeedCursor"]);
  });

  it("422 InvalidRequest for a cursor outside base64url or past 256 characters", async () => {
    const { call } = await given();
    const bad = await call("GET", "/me/feed/after/a%24b", "victor");
    const long = await call("GET", `/me/feed/after/${"a".repeat(257)}`, "victor");
    const edge = await call("GET", `/me/feed/after/${"a".repeat(256)}`, "victor");
    expect([bad.status, bad.json.error.code]).toEqual([422, "InvalidRequest"]);
    expect([long.status, long.json.error.code]).toEqual([422, "InvalidRequest"]);
    // 256 characters pass validation and reach the app, which refuses the content.
    expect([edge.status, edge.json.error.code]).toEqual([422, "InvalidFeedCursor"]);
  });
});

describe("reactions", () => {
  it("PUT then DELETE: counts only, the key may be percent-encoded or raw", async () => {
    const { call, log, sessionKey, reactionPath, seasonId } = await given();
    await log("andrea", 1);
    const key = sessionKey("andrea", 1);

    const put = await call("PUT", reactionPath(key), "victor", { emoji: "fire" });
    expect([put.status, put.json.data]).toEqual([
      200,
      { counts: { heart: 0, raisedHands: 0, fire: 1, clap: 0 }, mine: "fire", reactable: true },
    ]);
    // Changing it moves the single reaction; a raw colon in the path decodes to the same key.
    const raw = await call("PUT", `/seasons/${seasonId}/feed/${key}/reaction`, "victor", {
      emoji: "clap",
    });
    expect(raw.json.data).toEqual({
      counts: { heart: 0, raisedHands: 0, fire: 0, clap: 1 },
      mine: "clap",
      reactable: true,
    });

    // Andrea sees the count, never who: her own mark is null.
    const owner = await call("GET", "/me/feed", "andrea");
    const item = owner.json.data.items.find((i: { key: string }) => i.key === key);
    expect(item.reactions).toEqual({
      counts: { heart: 0, raisedHands: 0, fire: 0, clap: 1 },
      mine: null,
      reactable: false,
    });

    const del = await call("DELETE", reactionPath(key), "victor");
    expect([del.status, del.json.data]).toEqual([
      200,
      { counts: { heart: 0, raisedHands: 0, fire: 0, clap: 0 }, mine: null, reactable: true },
    ]);
    const again = await call("DELETE", reactionPath(key), "victor");
    expect(again.status).toBe(200);
  });

  it("%3A in the item key reaches the app as a colon (and %2F stays inside the segment)", async () => {
    const { call, log, sessionKey, reactionPath } = await given();
    await log("andrea", 1);
    const encoded = reactionPath(sessionKey("andrea", 1));
    expect(encoded).toContain("%3A");
    const ok = await call("PUT", encoded, "victor", { emoji: "heart" });
    expect(ok.status).toBe(200);
    const slash = await call("PUT", reactionPath("session:a/b:1"), "victor", { emoji: "heart" });
    expect([slash.status, slash.json.error.code]).toEqual([404, "FeedItemNotFound"]);
  });

  it("errors: own item, system item, unknown item, bad emoji, unknown season, bad body", async () => {
    const { call, log, sessionKey, reactionPath, seasonId, commitmentIds } = await given();
    await log("andrea", 1);
    const code = (res: { status: number; json: { error?: { code: string } } }) => [
      res.status,
      res.json.error?.code,
    ];

    const own = await call("PUT", reactionPath(sessionKey("andrea", 1)), "andrea", {
      emoji: "fire",
    });
    expect(code(own)).toEqual([409, "FeedItemNotReactable"]);
    const system = await call("PUT", reactionPath(`season-start:${seasonId}`), "victor", {
      emoji: "fire",
    });
    expect(code(system)).toEqual([409, "FeedItemNotReactable"]);
    const unknown = await call("PUT", reactionPath(`session:${commitmentIds.andrea}:9`), "victor", {
      emoji: "fire",
    });
    expect(code(unknown)).toEqual([404, "FeedItemNotFound"]);
    const emoji = await call("PUT", reactionPath(sessionKey("andrea", 1)), "victor", {
      emoji: "thumbsUp",
    });
    expect(code(emoji)).toEqual([422, "InvalidReaction"]);
    const season = await call(
      "PUT",
      `/seasons/${UNKNOWN}/feed/${encodeURIComponent(sessionKey("andrea", 1))}/reaction`,
      "victor",
      { emoji: "fire" },
    );
    expect(code(season)).toEqual([404, "SeasonNotFound"]);
    const body = await call("PUT", reactionPath(sessionKey("andrea", 1)), "victor", {});
    expect(code(body)).toEqual([422, "InvalidRequest"]);
    const long = await call("DELETE", reactionPath(`session:${"a".repeat(130)}`), "victor");
    expect(code(long)).toEqual([422, "InvalidRequest"]);
  });

  it("a reaction does not move points or standings", async () => {
    const { call, log, sessionKey, reactionPath, seasonId } = await given();
    await log("andrea", 1);
    const before = await call("GET", `/seasons/${seasonId}/standings`, "victor");
    await call("PUT", reactionPath(sessionKey("andrea", 1)), "victor", { emoji: "fire" });
    const after = await call("GET", `/seasons/${seasonId}/standings`, "victor");
    expect(after.json).toEqual(before.json);
  });
});

describe("encouragements and nudge dismissals", () => {
  /** Day 10: week 1 is final; Victor kept all of it, Andrea none. */
  async function hardWeek() {
    const ctx = await given();
    for (const n of [1, 2, 3]) await ctx.log("victor", n);
    ctx.setNow(day(10) as never);
    return ctx;
  }
  const send = (
    ctx: Awaited<ReturnType<typeof hardWeek>>,
    who: Who,
    over: Record<string, unknown> = {},
  ) =>
    ctx.call("POST", `/seasons/${ctx.seasonId}/encouragements`, who, {
      recipientId: ctx.andreaMemberId,
      week: 1,
      emoji: "raisedHands",
      ...over,
    });

  it("the nudge on /me/feed names the target and the week, and nothing else about it", async () => {
    const ctx = await hardWeek();
    const res = await ctx.call("GET", "/me/feed", "victor");
    expect(res.json.data.nudge).toEqual({
      seasonId: ctx.seasonId,
      targetId: ctx.andreaMemberId,
      week: 1,
      subject: { kind: "habit", name: "Run andrea", icon: null },
    });
    // Andrea is not the one who is offered a nudge: Victor kept his week.
    const andrea = await ctx.call("GET", "/me/feed", "andrea");
    expect(andrea.json.data.nudge).toBeNull();
  });

  it("201 {recipientId, week}; the recipient sees it, nobody else; a second send is 409", async () => {
    const ctx = await hardWeek();
    const res = await send(ctx, "victor");
    expect([res.status, res.json.data]).toEqual([
      201,
      { recipientId: ctx.andreaMemberId, week: 1 },
    ]);

    const andrea = await ctx.call("GET", "/me/feed", "andrea");
    const received = andrea.json.data.items.filter(
      (i: { kind: string }) => i.kind === "encouragementReceived",
    );
    expect(received).toHaveLength(1);
    expect(Object.keys(received[0]).sort()).toEqual([
      "at",
      "emoji",
      "key",
      "kind",
      "onDate",
      "senderId",
    ]);
    expect(received[0]).toMatchObject({ senderId: ctx.victorMemberId, emoji: "raisedHands" });

    const victor = await ctx.call("GET", "/me/feed", "victor");
    expect(
      victor.json.data.items.some((i: { kind: string }) => i.kind === "encouragementReceived"),
    ).toBe(false);
    expect(victor.json.data.nudge).toBeNull();

    const again = await send(ctx, "victor");
    expect([again.status, again.json.error.code]).toEqual([409, "EncouragementAlreadySent"]);
  });

  it("errors: bad emoji 422, no live case 409, shape 422", async () => {
    const ctx = await hardWeek();
    const emoji = await send(ctx, "victor", { emoji: "thumbsUp" });
    expect([emoji.status, emoji.json.error.code]).toEqual([422, "InvalidReaction"]);
    // Andrea has no case against Victor (he kept the week) and the week must be the live one.
    const none = await send(ctx, "andrea", { recipientId: ctx.victorMemberId });
    expect([none.status, none.json.error.code]).toEqual([409, "NudgeNotAvailable"]);
    const wrongWeek = await send(ctx, "victor", { week: 2 });
    expect([wrongWeek.status, wrongWeek.json.error.code]).toEqual([409, "NudgeNotAvailable"]);
    for (const over of [{ week: 0 }, { week: 1.5 }, { recipientId: "nope" }, { emoji: 3 }]) {
      const res = await send(ctx, "victor", over);
      expect([over, res.status, res.json.error.code]).toEqual([over, 422, "InvalidRequest"]);
    }
  });

  it("dismissal: 200 {}, idempotent, and the case is gone afterwards", async () => {
    const ctx = await hardWeek();
    const dismiss = () =>
      ctx.call("POST", `/seasons/${ctx.seasonId}/nudge-dismissals`, "victor", {
        targetId: ctx.andreaMemberId,
        week: 1,
      });
    const first = await dismiss();
    expect([first.status, first.json.data]).toEqual([200, {}]);
    const second = await dismiss();
    expect([second.status, second.json.data]).toEqual([200, {}]);

    const feed = await ctx.call("GET", "/me/feed", "victor");
    expect(feed.json.data.nudge).toBeNull();
    const sent = await send(ctx, "victor");
    expect([sent.status, sent.json.error.code]).toEqual([409, "NudgeNotAvailable"]);
  });

  it("dismissal with no case is 409, with a bad body 422", async () => {
    const ctx = await hardWeek();
    const none = await ctx.call("POST", `/seasons/${ctx.seasonId}/nudge-dismissals`, "andrea", {
      targetId: ctx.victorMemberId,
      week: 1,
    });
    expect([none.status, none.json.error.code]).toEqual([409, "NudgeNotAvailable"]);
    const bad = await ctx.call("POST", `/seasons/${ctx.seasonId}/nudge-dismissals`, "victor", {
      targetId: "nope",
      week: 1,
    });
    expect([bad.status, bad.json.error.code]).toEqual([422, "InvalidRequest"]);
  });
});
