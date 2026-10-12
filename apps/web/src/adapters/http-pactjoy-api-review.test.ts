import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import {
  baselineFixture,
  interimFullFixture,
  skippedFixture,
  stageFixture,
  submittedFixture,
} from "../testing/fixtures/review.ts";
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

describe("HttpPactJoyApi review methods (ADR-0011 Q21)", () => {
  it("getReview reads GET /seasons/:id/reviews/:periodIndex", async () => {
    const draft = interimFullFixture();
    const { api, sent } = harness(json(200, { data: draft }));
    await expect(api.getReview("season-1", 2)).resolves.toEqual(draft);
    expect([sent().method, sent().url]).toEqual(["GET", `${BASE}/seasons/season-1/reviews/2`]);
  });

  it("getReview reads the baseline as period 0", async () => {
    const { api, sent } = harness(json(200, { data: baselineFixture() }));
    await api.getReview("season-1", 0);
    expect(sent().url).toBe(`${BASE}/seasons/season-1/reviews/0`);
  });

  it("getReview turns a body that is not a draft into ApiError(Internal)", async () => {
    const { api } = harness(json(200, { data: { status: "due" } }));
    await expect(api.getReview("season-1", 2)).rejects.toMatchObject({ code: "Internal" });
  });

  it("submitReview posts the reflection and the four slots per commitment", async () => {
    const result = submittedFixture();
    const { api, sent } = harness(json(201, { data: result }));
    const command = {
      reflection: { helped: "Leer de noche", hard: null },
      automaticity: [{ commitmentId: "c-1", items: [5, 4, 5, 4] as const }],
    };
    await expect(api.submitReview("season-1", 2, command)).resolves.toEqual(result);
    expect(sent()).toEqual({
      method: "POST",
      url: `${BASE}/seasons/season-1/reviews/2`,
      body: command,
    });
  });

  it("submitReview surfaces the API error code and details", async () => {
    const { api } = harness(
      json(422, { error: { code: "NoteTooLong", details: { field: "helped" } } }),
    );
    const failure = await api
      .submitReview("season-1", 2, { reflection: { helped: "x", hard: null }, automaticity: [] })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      code: "NoteTooLong",
      status: 422,
      details: { field: "helped" },
    });
  });

  it("skipBaseline posts to the skip route of period 0 with no body", async () => {
    const { api, sent } = harness(json(200, { data: skippedFixture() }));
    await expect(api.skipBaseline("season-1")).resolves.toBeUndefined();
    expect(sent()).toEqual({
      method: "POST",
      url: `${BASE}/seasons/season-1/reviews/0/skip`,
      body: undefined,
    });
  });

  it("getCommitmentStage reads GET /seasons/:id/commitments/:cid/stage", async () => {
    const view = stageFixture("c-1", "developing");
    const { api, sent } = harness(json(200, { data: view }));
    await expect(api.getCommitmentStage("season-1", "c-1")).resolves.toEqual(view);
    expect([sent().method, sent().url]).toEqual([
      "GET",
      `${BASE}/seasons/season-1/commitments/c-1/stage`,
    ]);
  });
});
