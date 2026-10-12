import { describe, expect, it, vi } from "vitest";
import {
  myPauseRequestsFixture,
  pauseApprovalFixture,
  pauseRequestFixture,
} from "../testing/fixtures/pause.ts";
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

describe("HttpPactJoyApi pause methods (ADR-0011 Q20)", () => {
  it("requestPause posts the scope, reason, note and dates to the season's pause-requests", async () => {
    const { api, sent } = harness(json(201, { data: pauseRequestFixture() }));
    const command = {
      scope: { kind: "commitment", commitmentId: "c-1" },
      reason: "health",
      note: null,
      startDate: "2026-10-02",
      endDate: null,
    } as const;
    await expect(api.requestPause("season-1", command)).resolves.toEqual(pauseRequestFixture());
    expect(sent()).toEqual({
      method: "POST",
      url: `${BASE}/seasons/season-1/pause-requests`,
      body: command,
    });
  });

  it("getMyPauseRequests reads GET /me/pause-requests", async () => {
    const view = myPauseRequestsFixture({ awaitingMe: [pauseApprovalFixture()] });
    const { api, sent } = harness(json(200, { data: view }));
    await expect(api.getMyPauseRequests()).resolves.toEqual(view);
    expect([sent().method, sent().url]).toEqual(["GET", `${BASE}/me/pause-requests`]);
  });

  it("respondToPause puts only the decision (no expectedVersion, D2)", async () => {
    const { api, sent } = harness(
      json(200, { data: pauseApprovalFixture({ myResponse: "approve" }) }),
    );
    await expect(api.respondToPause("pause-9", "approve")).resolves.toMatchObject({
      myResponse: "approve",
    });
    expect(sent()).toEqual({
      method: "PUT",
      url: `${BASE}/pause-requests/pause-9/response`,
      body: { decision: "approve" },
    });
  });

  it("cancelPauseRequest deletes the request and returns its view", async () => {
    const { api, sent } = harness(
      json(200, { data: pauseRequestFixture({ status: "cancelled" }) }),
    );
    await expect(api.cancelPauseRequest("pause-1")).resolves.toMatchObject({ status: "cancelled" });
    expect([sent().method, sent().url]).toEqual(["DELETE", `${BASE}/pause-requests/pause-1`]);
  });

  it("resumePause posts the Commitment, or an empty body for all of them", async () => {
    const one = harness(json(200, { data: pauseRequestFixture({ status: "approved" }) }));
    await one.api.resumePause("pause-1", "c-1");
    expect(one.sent()).toMatchObject({
      method: "POST",
      url: `${BASE}/pause-requests/pause-1/resume`,
      body: { commitmentId: "c-1" },
    });
    const all = harness(json(200, { data: pauseRequestFixture({ status: "approved" }) }));
    await all.api.resumePause("pause-1");
    expect(all.sent().body).toEqual({});
  });

  it("encodes ids in the path", async () => {
    const { api, sent } = harness(json(200, { data: pauseRequestFixture() }));
    await api.cancelPauseRequest("a/b");
    expect(sent().url).toBe(`${BASE}/pause-requests/a%2Fb`);
  });

  it("rejects a 2xx that is not the read model as Internal", async () => {
    const { api } = harness(json(200, { data: { mine: "nope" } }));
    await expect(api.getMyPauseRequests()).rejects.toMatchObject({ code: "Internal" });
  });

  it("rejects a hidden Commitment that carries anything beyond its id (Q15)", async () => {
    const leaky = pauseApprovalFixture({
      commitments: [
        { kind: "hidden", commitmentId: "c-9", habitName: "Terapia" } as unknown as never,
      ],
    });
    const { api } = harness(json(200, { data: myPauseRequestsFixture({ awaitingMe: [leaky] }) }));
    await expect(api.getMyPauseRequests()).rejects.toMatchObject({ code: "Internal" });
  });

  it("accepts a hidden Commitment that is exactly its id", async () => {
    const hidden = pauseApprovalFixture({ commitments: [{ kind: "hidden", commitmentId: "c-9" }] });
    const view = myPauseRequestsFixture({ awaitingMe: [hidden] });
    const { api } = harness(json(200, { data: view }));
    await expect(api.getMyPauseRequests()).resolves.toEqual(view);
  });

  it("surfaces the cap error with its Commitments as details", async () => {
    const details = {
      commitments: [{ commitmentId: "c-1", reason: "capExhausted", remainingDays: 0 }],
    };
    const { api } = harness(json(409, { error: { code: "PauseCapExceeded", details } }));
    await expect(
      api.requestPause("s", {
        scope: { kind: "all" },
        reason: "work",
        note: null,
        startDate: "2026-10-02",
        endDate: null,
      }),
    ).rejects.toMatchObject({ code: "PauseCapExceeded", status: 409, details });
  });
});
