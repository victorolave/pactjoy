import { describe, expect, it, vi } from "vitest";
import type { PactJoyApi } from "../ports/pactjoy-api.ts";
import { HttpPactJoyApi } from "./http-pactjoy-api.ts";

const habit = { name: "Leer", icon: "book" };
const habitDto = {
  id: "h1",
  name: "Leer",
  why: null,
  category: null,
  icon: "book",
  createdAt: "2026-10-01T00:00:00.000Z",
  version: 1,
};
const seasonDto = {
  id: "s1",
  status: "pactOpen",
  commitments: [],
  approvals: [],
  pactRevision: 0,
  version: 1,
};
const measure = { unit: "done", frequency: { kind: "timesPerWeek", times: 3 } } as const;
const commitment = { habitId: "h1", measure, privacy: "private", weightPercent: 100 } as const;
const season = { timezone: "America/Bogota", startDate: "2026-10-07", lengthWeeks: 8 } as const;
type Case = [string, (api: PactJoyApi) => Promise<unknown>, string, unknown, unknown, unknown];
const cases: Case[] = [
  ["GET", (a) => a.listHabits(), "/habits", undefined, { habits: [habitDto] }, [habitDto]],
  ["POST", (a) => a.createHabit(habit), "/habits", habit, habitDto, habitDto],
  [
    "PATCH",
    (a) => a.updateHabit("h/1", { expectedVersion: 2, icon: null }),
    "/habits/h%2F1",
    { expectedVersion: 2, icon: null },
    habitDto,
    habitDto,
  ],
  [
    "POST",
    (a) => a.createSeason("c/1", season),
    "/circles/c%2F1/seasons",
    season,
    seasonDto,
    seasonDto,
  ],
  ["GET", (a) => a.getSeason("s/1"), "/seasons/s%2F1", undefined, seasonDto, seasonDto],
  [
    "PATCH",
    (a) => a.editSeason("s1", { lengthWeeks: 6 }),
    "/seasons/s1",
    { lengthWeeks: 6 },
    seasonDto,
    seasonDto,
  ],
  [
    "POST",
    (a) => a.addCommitment("s1", commitment),
    "/seasons/s1/commitments",
    commitment,
    seasonDto,
    seasonDto,
  ],
  [
    "PUT",
    (a) => a.editCommitment("s1", "c/1", { measure, privacy: "visible", weightPercent: 50 }),
    "/seasons/s1/commitments/c%2F1",
    { measure, privacy: "visible", weightPercent: 50 },
    seasonDto,
    seasonDto,
  ],
  [
    "DELETE",
    (a) => a.removeCommitment("s1", "c/1"),
    "/seasons/s1/commitments/c%2F1",
    undefined,
    seasonDto,
    seasonDto,
  ],
  [
    "PUT",
    (a) => a.approvePact("s1", 7),
    "/seasons/s1/approval",
    { expectedPactRevision: 7 },
    seasonDto,
    seasonDto,
  ],
  [
    "DELETE",
    (a) => a.withdrawApproval("s1"),
    "/seasons/s1/approval",
    undefined,
    seasonDto,
    seasonDto,
  ],
  [
    "POST",
    (a) => a.previewScoring({ measure, values: ["1", "0"] }),
    "/scoring/preview",
    { measure, values: ["1", "0"] },
    { rows: [{ value: "1", progressPercent: "100" }] },
    { rows: [{ value: "1", progressPercent: "100" }] },
  ],
];

function setup(data: unknown, status = 200) {
  const fetchStub = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ data }), { status }),
  );
  const api = new HttpPactJoyApi({
    baseUrl: "https://api.test",
    fetch: fetchStub,
    getAccessToken: async () => "token",
    refreshAccessToken: async () => ({ status: "rejected" }),
    onUnauthorized: () => {},
  });
  return { api, fetchStub };
}
describe("HttpPactJoyApi habit, season, commitment, pact and preview methods", () => {
  it.each(cases)(
    "%s %s maps the method, encoded ids and body",
    async (verb, call, path, body, data, expected) => {
      const { api, fetchStub } = setup(data);
      expect(await call(api)).toEqual(expected);
      const [url, init] = fetchStub.mock.calls[0] ?? [];
      expect(url).toBe(`https://api.test${path}`);
      expect(init?.method).toBe(verb);
      expect(typeof init?.body === "string" ? JSON.parse(init.body) : undefined).toEqual(body);
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
    },
  );
  it("unwraps an empty habit list and propagates AbortSignal on reads and previews", async () => {
    const { api, fetchStub } = setup({ habits: [] });
    const signal = new AbortController().signal;
    expect(await api.listHabits(signal)).toEqual([]);
    expect(fetchStub.mock.calls[0]?.[1]?.signal).toBe(signal);
    const preview = setup({ rows: [] });
    await preview.api.previewScoring({ measure, values: ["1"] }, signal);
    expect(preview.fetchStub.mock.calls[0]?.[1]?.signal).toBe(signal);
  });
  it("rejects malformed read envelopes rather than trusting them", async () => {
    await expect(setup({ habits: "nope" }).api.listHabits()).rejects.toMatchObject({
      code: "Internal",
    });
    await expect(
      setup({ rows: "nope" }).api.previewScoring({ measure, values: ["1"] }),
    ).rejects.toMatchObject({ code: "Internal" });
    await expect(setup({}).api.getSeason("s1")).rejects.toMatchObject({ code: "Internal" });
  });
  it.each([
    [null],
    [{}],
    [{ value: 1, progressPercent: "100" }],
    [{ value: "1", progressPercent: 100 }],
    [{ value: "1", progressPercent: "not a percent" }],
    [{ value: "1", progressPercent: "101" }],
    [{ value: "1", progressPercent: "-1" }],
  ])("rejects malformed preview rows %j", async (row) => {
    await expect(
      setup({ rows: [row] }).api.previewScoring({ measure, values: ["1"] }),
    ).rejects.toMatchObject({ code: "Internal" });
  });
  it("rejects habit and season bodies that only carry an id", async () => {
    const internal = { code: "Internal" };
    await expect(setup({ id: "h1" }).api.createHabit(habit)).rejects.toMatchObject(internal);
    await expect(setup({ habits: [{ id: "h1" }] }).api.listHabits()).rejects.toMatchObject(
      internal,
    );
    await expect(setup({ id: "s1" }).api.getSeason("s1")).rejects.toMatchObject(internal);
    await expect(
      setup({ ...seasonDto, commitments: null }).api.approvePact("s1", 0),
    ).rejects.toMatchObject(internal);
  });
});
