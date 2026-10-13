import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import { profileSummaryFixture } from "../testing/fixtures/profile.ts";
import {
  carryOverFixture,
  resultsFixture,
  seasonHistoryFixture,
  submittedClosureFixture,
} from "../testing/fixtures/season-close.ts";
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

describe("HttpPactJoyApi season close methods (ADR-0015)", () => {
  it("getSeasonResults reads GET /seasons/:id/results", async () => {
    const results = resultsFixture();
    const { api, sent } = harness(json(200, { data: results }));
    await expect(api.getSeasonResults("season-1")).resolves.toEqual(results);
    expect([sent().method, sent().url]).toEqual(["GET", `${BASE}/seasons/season-1/results`]);
  });

  it("getSeasonResults turns a body that is not the results into ApiError(Internal)", async () => {
    const { api } = harness(json(200, { data: { seasonId: "season-1" } }));
    await expect(api.getSeasonResults("season-1")).rejects.toMatchObject({ code: "Internal" });
  });

  it("getSeasonResults keeps the date a too-early read names", async () => {
    const { api } = harness(
      json(409, {
        error: { code: "SeasonResultsNotYet", details: { availableOn: "2026-10-21" } },
      }),
    );
    const failure = await api.getSeasonResults("season-1").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: "SeasonResultsNotYet",
      status: 409,
      details: { availableOn: "2026-10-21" },
    });
  });

  it("submitSeasonClosure posts every decision once, with no member id", async () => {
    const stored = submittedClosureFixture();
    const { api, sent } = harness(json(201, { data: stored }));
    const command = { decisions: stored.decisions };
    await expect(api.submitSeasonClosure("season-1", command)).resolves.toEqual(stored);
    expect(sent()).toEqual({
      method: "POST",
      url: `${BASE}/seasons/season-1/closure`,
      body: command,
    });
  });

  it("submitSeasonClosure surfaces the rejection kind and which commitments are missing", async () => {
    const { api } = harness(
      json(422, { error: { code: "ClosureIncomplete", details: { commitmentIds: ["c-1"] } } }),
    );
    await expect(api.submitSeasonClosure("season-1", { decisions: [] })).rejects.toMatchObject({
      code: "ClosureIncomplete",
      status: 422,
    });
  });

  it("getCarryOver reads GET /seasons/:id/carry-over", async () => {
    const view = carryOverFixture({ previousSeasonId: "season-0" });
    const { api, sent } = harness(json(200, { data: view }));
    await expect(api.getCarryOver("season-2")).resolves.toEqual(view);
    expect([sent().method, sent().url]).toEqual(["GET", `${BASE}/seasons/season-2/carry-over`]);
  });

  it("getSeasonHistory reads GET /me/seasons", async () => {
    const view = seasonHistoryFixture();
    const { api, sent } = harness(json(200, { data: view }));
    await expect(api.getSeasonHistory()).resolves.toEqual(view);
    expect([sent().method, sent().url]).toEqual(["GET", `${BASE}/me/seasons`]);
  });

  it("encodes the season id in the path", async () => {
    const { api, sent } = harness(json(200, { data: resultsFixture() }));
    await api.getSeasonResults("a/b");
    expect(sent().url).toBe(`${BASE}/seasons/a%2Fb/results`);
  });

  it("getProfileSummary reads GET /me/profile", async () => {
    const view = profileSummaryFixture();
    const { api, sent } = harness(json(200, { data: view }));
    await expect(api.getProfileSummary()).resolves.toEqual(view);
    expect([sent().method, sent().url]).toEqual(["GET", `${BASE}/me/profile`]);
  });

  it("getProfileSummary turns a malformed 2xx into an Internal error", async () => {
    const { api } = harness(json(200, { data: { consistency: null, habits: [] } }));
    await expect(api.getProfileSummary()).rejects.toMatchObject({ code: "Internal" });
  });
});
