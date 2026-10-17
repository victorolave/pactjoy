import { describe, expect, it, vi } from "vitest";
import { feedFixture, nudgeFixture, reactionsFixture } from "../testing/fixtures/social.ts";
import { HttpPactJoyApi } from "./http-pactjoy-api.ts";

const BASE = "http://api.test/api";
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

function harness(response: Response) {
  const fetchStub = vi.fn<typeof fetch>(async () => response);
  const api = new HttpPactJoyApi({
    baseUrl: BASE,
    getAccessToken: async () => "t1",
    refreshAccessToken: async () => ({ status: "rejected" }),
    onUnauthorized: () => {},
    fetch: fetchStub,
  });
  const sent = () => {
    const [url, init] = fetchStub.mock.calls[0] ?? [];
    return {
      url: String(url),
      method: init?.method,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
  };
  return { api, sent };
}

describe("HttpPactJoyApi social methods (ADR-0011 Q25)", () => {
  it("feed() reads the first page with GET /me/feed", async () => {
    const page = feedFixture({ nudge: nudgeFixture() });
    const { api, sent } = harness(json(200, { data: page }));
    await expect(api.feed()).resolves.toEqual(page);
    expect([sent().method, sent().url]).toEqual(["GET", `${BASE}/me/feed`]);
  });

  it("feed(cursor) reads the next page, encoding the cursor in the path", async () => {
    const { api, sent } = harness(json(200, { data: feedFixture() }));
    await api.feed("ab_-/+=");
    expect(sent().url).toBe(`${BASE}/me/feed/after/ab_-%2F%2B%3D`);
  });

  it("feed() turns a body that is not a feed into ApiError(Internal)", async () => {
    const { api } = harness(json(200, { data: { items: "none" } }));
    await expect(api.feed()).rejects.toMatchObject({ code: "Internal" });
  });

  it("reactToFeedItem puts the emoji code, encoding the item key (':' becomes %3A)", async () => {
    const mine = reactionsFixture({ mine: "fire" });
    const { api, sent } = harness(json(200, { data: mine }));
    await expect(
      api.reactToFeedItem("season 1", "session:commitment-correr:2", "fire"),
    ).resolves.toEqual(mine);
    expect([sent().method, sent().url, sent().body]).toEqual([
      "PUT",
      `${BASE}/seasons/season%201/feed/session%3Acommitment-correr%3A2/reaction`,
      { emoji: "fire" },
    ]);
  });

  it("removeFeedReaction deletes the same path", async () => {
    const { api, sent } = harness(json(200, { data: reactionsFixture() }));
    await expect(api.removeFeedReaction("season-1", "week:c1:1")).resolves.toEqual(
      reactionsFixture(),
    );
    expect([sent().method, sent().url]).toEqual([
      "DELETE",
      `${BASE}/seasons/season-1/feed/week%3Ac1%3A1/reaction`,
    ]);
  });

  it("a reaction answer that is not Reactions is ApiError(Internal)", async () => {
    const { api } = harness(json(200, { data: { counts: {} } }));
    await expect(api.reactToFeedItem("s", "k:1", "heart")).rejects.toMatchObject({
      code: "Internal",
    });
  });

  it("sendEncouragement posts the recipient, the case week and the emoji", async () => {
    const { api, sent } = harness(json(201, { data: { recipientId: "m1", week: 2 } }));
    await expect(
      api.sendEncouragement("season-1", { recipientId: "m1", week: 2, emoji: "raisedHands" }),
    ).resolves.toBeUndefined();
    expect([sent().method, sent().url, sent().body]).toEqual([
      "POST",
      `${BASE}/seasons/season-1/encouragements`,
      { recipientId: "m1", week: 2, emoji: "raisedHands" },
    ]);
  });

  it("dismissNudge posts the target and the case week", async () => {
    const { api, sent } = harness(json(200, { data: {} }));
    await expect(
      api.dismissNudge("season-1", { targetId: "m1", week: 2 }),
    ).resolves.toBeUndefined();
    expect([sent().method, sent().url, sent().body]).toEqual([
      "POST",
      `${BASE}/seasons/season-1/nudge-dismissals`,
      { targetId: "m1", week: 2 },
    ]);
  });

  it("surfaces the API's typed errors (409 EncouragementAlreadySent)", async () => {
    const { api } = harness(
      json(409, { error: { code: "EncouragementAlreadySent", message: "x" } }),
    );
    await expect(
      api.sendEncouragement("season-1", { recipientId: "m1", week: 2, emoji: "fire" }),
    ).rejects.toMatchObject({ code: "EncouragementAlreadySent", status: 409 });
  });
});
