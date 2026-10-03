import type { TodayView } from "@pactjoy/app";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import { HttpPactJoyApi } from "./http-pactjoy-api.ts";

const BASE = "http://api.test/api";
const TODAY: TodayView = { state: "noCircle" };

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });

type FetchStub = ReturnType<typeof vi.fn<typeof fetch>>;

interface Harness {
  readonly api: HttpPactJoyApi;
  readonly fetchStub: FetchStub;
  readonly onUnauthorized: ReturnType<typeof vi.fn>;
  readonly refreshAccessToken: ReturnType<typeof vi.fn>;
}

function harness(responses: Array<Response | Error>, tokens = ["t1"]): Harness {
  const queue = [...responses];
  const fetchStub = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("fetch called more often than scripted");
    if (next instanceof Error) throw next;
    return next;
  });
  const onUnauthorized = vi.fn();
  const refreshQueue = [...tokens.slice(1)];
  const refreshAccessToken = vi.fn(async () => refreshQueue.shift() ?? null);
  const api = new HttpPactJoyApi({
    baseUrl: BASE,
    getAccessToken: async () => tokens[0] ?? null,
    refreshAccessToken,
    onUnauthorized,
    fetch: fetchStub,
  });
  return { api, fetchStub, onUnauthorized, refreshAccessToken };
}

const call = (stub: FetchStub, index = 0) => {
  const [url, init] = stub.mock.calls[index] ?? [];
  return {
    url: String(url),
    method: init?.method,
    headers: new Headers(init?.headers),
    body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
  };
};

describe("HttpPactJoyApi.getToday", () => {
  it("unwraps the {data} envelope and sends the bearer token", async () => {
    const { api, fetchStub } = harness([json(200, { data: TODAY })]);
    await expect(api.getToday()).resolves.toEqual(TODAY);
    const request = call(fetchStub);
    expect(request.url).toBe(`${BASE}/me/today`);
    expect(request.method).toBe("GET");
    expect(request.headers.get("Authorization")).toBe("Bearer t1");
  });

  it("omits Authorization when there is no token", async () => {
    const fetchStub = vi.fn<typeof fetch>(async () => json(200, { data: TODAY }));
    const api = new HttpPactJoyApi({
      baseUrl: BASE,
      getAccessToken: async () => null,
      refreshAccessToken: async () => null,
      onUnauthorized: () => {},
      fetch: fetchStub,
    });
    await api.getToday();
    expect(call(fetchStub).headers.has("Authorization")).toBe(false);
  });

  it("maps an error envelope to ApiError with code, status, requestId and details (AC-S1)", async () => {
    const { api } = harness([
      json(
        409,
        { error: { code: "WindowClosed", message: "closed", details: { day: 3 } } },
        { "X-Request-Id": "rid-9" },
      ),
    ]);
    const error = await api.getToday().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: "WindowClosed",
      status: 409,
      requestId: "rid-9",
      details: { day: 3 },
    });
  });

  it("maps another error code with a null requestId when the header is absent", async () => {
    const { api } = harness([json(404, { error: { code: "SeasonNotFound", message: "x" } })]);
    await expect(api.getToday()).rejects.toMatchObject({
      code: "SeasonNotFound",
      status: 404,
      requestId: null,
    });
  });

  it("turns a rejected fetch into NetworkError with status 0 (AC-S2)", async () => {
    const { api } = harness([new TypeError("Failed to fetch")]);
    await expect(api.getToday()).rejects.toMatchObject({ code: "NetworkError", status: 0 });
  });

  it("turns an empty 503 (no JSON body) into ServiceUnavailable", async () => {
    const { api } = harness([new Response(null, { status: 503 })]);
    await expect(api.getToday()).rejects.toMatchObject({
      code: "ServiceUnavailable",
      status: 503,
    });
  });

  it("turns a non-JSON 500 into Internal", async () => {
    const { api } = harness([new Response("boom", { status: 500 })]);
    await expect(api.getToday()).rejects.toMatchObject({ code: "Internal", status: 500 });
  });

  it("forwards the abort signal", async () => {
    const { api, fetchStub } = harness([json(200, { data: TODAY })]);
    const controller = new AbortController();
    await api.getToday(controller.signal);
    expect(fetchStub.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });

  it.each([
    ["a 2xx without an envelope", json(200, { unexpected: true })],
    ["data that is null", json(200, { data: null })],
    ["data that is not an object", json(200, { data: "today" })],
    ["data without a string state", json(200, { data: { state: 3 } })],
    ["a non-JSON body", new Response("<html>", { status: 200 })],
  ])("rejects %s with Internal, keeping status and requestId", async (_name, response) => {
    response.headers.set("X-Request-Id", "rid-5");
    const { api } = harness([response]);
    await expect(api.getToday()).rejects.toMatchObject({
      code: "Internal",
      status: 200,
      requestId: "rid-5",
    });
  });
});

describe("HttpPactJoyApi 401 handling (AU-R5)", () => {
  it("refreshes once and retries with the new token", async () => {
    const { api, fetchStub, refreshAccessToken, onUnauthorized } = harness(
      [json(401, { error: { code: "Unauthorized", message: "no" } }), json(200, { data: TODAY })],
      ["old", "new"],
    );
    await expect(api.getToday()).resolves.toEqual(TODAY);
    expect(refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(call(fetchStub, 0).headers.get("Authorization")).toBe("Bearer old");
    expect(call(fetchStub, 1).headers.get("Authorization")).toBe("Bearer new");
  });

  it("calls onUnauthorized and throws after a second 401, with no further retry", async () => {
    const unauthorized = () => json(401, { error: { code: "Unauthorized", message: "no" } });
    const { api, fetchStub, onUnauthorized } = harness(
      [unauthorized(), unauthorized()],
      ["old", "new"],
    );
    await expect(api.getToday()).rejects.toMatchObject({ code: "Unauthorized", status: 401 });
    expect(fetchStub).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it("calls onUnauthorized when the refresh yields no token", async () => {
    const { api, fetchStub, onUnauthorized } = harness(
      [json(401, { error: { code: "Unauthorized", message: "no" } })],
      ["old"],
    );
    await expect(api.getToday()).rejects.toMatchObject({ code: "Unauthorized" });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });
});
