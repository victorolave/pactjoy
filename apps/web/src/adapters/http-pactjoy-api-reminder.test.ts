import { describe, expect, it, vi } from "vitest";
import { HttpPactJoyApi } from "./http-pactjoy-api.ts";

/** The owner's commitment reminder (ADR-0017 addendum, D2): read it, and save it. */

const BASE = "http://api.test/api";
const S = "11111111-0000-4000-8000-000000000001";
const C = "22222222-0000-4000-8000-000000000002";
const PATH = `${BASE}/seasons/${S}/commitments/${C}/reminder`;
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const REMINDER = {
  commitmentId: C,
  enabled: true,
  minuteOfDay: 1200,
  weekdays: [0, 2, 4],
  availableWeekdays: [0, 1, 2, 3, 4, 5, 6],
};

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

describe("HttpPactJoyApi reminder methods", () => {
  it("getCommitmentReminder reads GET .../reminder", async () => {
    const { api, sent } = harness(json(200, { data: REMINDER }));
    await expect(api.getCommitmentReminder(S, C)).resolves.toEqual(REMINDER);
    expect([sent().method, sent().url]).toEqual(["GET", PATH]);
  });

  it("setCommitmentReminder PUTs the setting and returns the saved one", async () => {
    const { api, sent } = harness(json(200, { data: REMINDER }));
    const setting = { enabled: true, minuteOfDay: 1200, weekdays: [0, 2, 4] };
    await expect(api.setCommitmentReminder(S, C, setting)).resolves.toEqual(REMINDER);
    expect(sent()).toEqual({ method: "PUT", url: PATH, body: setting });
  });

  it.each([
    { ...REMINDER, enabled: "yes" },
    { ...REMINDER, minuteOfDay: "20:00" },
    { ...REMINDER, weekdays: [0, 9] },
    { ...REMINDER, availableWeekdays: undefined },
  ])("turns a body of another shape into ApiError(Internal): %j", async (data) => {
    const { api } = harness(json(200, { data }));
    await expect(api.getCommitmentReminder(S, C)).rejects.toMatchObject({ code: "Internal" });
  });
});
