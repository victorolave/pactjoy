import { describe, expect, it, vi } from "vitest";
import type { PactJoyApi } from "../ports/pactjoy-api.ts";
import {
  activeSeasonProgress,
  commitmentProgress,
  endedSeasonProgress,
  firstDaySeasonProgress,
  peerMemberProgress,
  weekSummary,
} from "../testing/fixtures/season-progress.ts";
import { HttpPactJoyApi } from "./http-pactjoy-api.ts";

function apiReturning(data: unknown) {
  const fetch = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify({ data }), { status: 200 }),
  );
  const api = new HttpPactJoyApi({
    baseUrl: "https://api.test",
    getAccessToken: async () => "token",
    refreshAccessToken: async () => ({ status: "rejected" }),
    onUnauthorized: () => {},
    fetch,
  });
  return { api, fetch };
}

type Read = (api: PactJoyApi) => Promise<unknown>;
const reads: [string, Read, string, unknown][] = [
  ["season", (a) => a.getSeasonProgress("s/1"), "/seasons/s%2F1/progress", activeSeasonProgress()],
  [
    "member",
    (a) => a.getMemberProgress("s1", "member-andrea"),
    "/seasons/s1/members/member-andrea/progress",
    peerMemberProgress(),
  ],
  [
    "commitment",
    (a) => a.getCommitmentProgress("s1", "c1"),
    "/seasons/s1/commitments/c1/progress",
    commitmentProgress(),
  ],
  ["week", (a) => a.getWeekSummary("s1", 3), "/seasons/s1/weeks/3/summary", weekSummary()],
];

describe("HttpPactJoyApi progress reads", () => {
  it.each(reads)(
    "GETs the %s progress path and returns the validated view",
    async (_n, read, path, view) => {
      const { api, fetch } = apiReturning(view);
      await expect(read(api)).resolves.toEqual(view);
      const [url, init] = fetch.mock.calls[0] ?? [];
      expect(url).toBe(`https://api.test${path}`);
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer token");
    },
  );

  it.each([
    ["solo", activeSeasonProgress({ memberCount: 1 })],
    ["six members", activeSeasonProgress({ memberCount: 6 })],
    ["first day, nulls and unnumbered rows", firstDaySeasonProgress()],
    ["ended", endedSeasonProgress()],
    ["not started", { state: "notStarted", seasonId: "s1" }],
  ])("accepts a %s season", async (_n, view) => {
    await expect(apiReturning(view).api.getSeasonProgress("s1")).resolves.toEqual(view);
  });

  it("accepts a peer's aggregates over all commitments next to an exact private row", async () => {
    const view = peerMemberProgress();
    expect(view.consistency).toBe(88);
    await expect(apiReturning(view).api.getMemberProgress("s1", "m1")).resolves.toEqual(view);
  });

  it("accepts a week summary without a headline or circle line", async () => {
    const view = weekSummary({ headline: null, circle: null, consistency: null });
    await expect(apiReturning(view).api.getWeekSummary("s1", 3)).resolves.toEqual(view);
  });
});

const peer = peerMemberProgress();
const hidden = { kind: "hidden", commitmentId: "c9", weightPercent: 30, points: 118 };
const season = activeSeasonProgress();
const detail = commitmentProgress();
const cell = detail.weeks[0]?.cells[0];

const malformed: [string, Read, unknown][] = [
  [
    "standings without the hasEntries fact",
    (a) => a.getSeasonProgress("s1"),
    (() => {
      const { hasEntries: _, ...standings } = activeSeasonProgress().standings;
      return { ...activeSeasonProgress(), standings };
    })(),
  ],
  [
    "a private row with a habit name",
    (a) => a.getMemberProgress("s1", "m1"),
    {
      ...peer,
      commitments: [{ ...hidden, habit: { name: "Secreto", icon: null } }],
    },
  ],
  [
    "a private row with a peer metric",
    (a) => a.getMemberProgress("s1", "m1"),
    {
      ...peer,
      commitments: [{ ...hidden, consistency: 50 }],
    },
  ],
  [
    "a hidden row in the viewer's own scope",
    (a) => a.getMemberProgress("s1", "m1"),
    {
      ...peer,
      scope: "own",
      commitments: [hidden],
    },
  ],
  [
    "a peer's private commitment sent as a detail row",
    (a) => a.getMemberProgress("s1", "m1"),
    {
      ...peer,
      commitments: [{ ...peer.commitments[0], privacy: "private" }],
    },
  ],
  [
    "a season time zone that is not a usable IANA zone",
    (a) => a.getSeasonProgress("s1"),
    { ...season, season: { ...season.season, timeZone: "Mars/Olympus_Mons" } },
  ],
  [
    "a week summary in an unusable time zone",
    (a) => a.getWeekSummary("s1", 3),
    { ...weekSummary(), season: { ...season.season, timeZone: "not a zone" } },
  ],
  [
    "a string rank",
    (a) => a.getSeasonProgress("s1"),
    {
      ...season,
      standings: { ...season.standings, rows: [{ ...season.standings.rows[0], rank: "1" }] },
    },
  ],
  [
    "a malformed date",
    (a) => a.getSeasonProgress("s1"),
    {
      ...season,
      calendar: { ...season.calendar, today: "24/09/2026" },
    },
  ],
  ["an unknown state", (a) => a.getSeasonProgress("s1"), { ...season, state: "paused" }],
  ["a missing weeks array", (a) => a.getSeasonProgress("s1"), { ...season, weeks: undefined }],
  [
    "a non-decimal threshold",
    (a) => a.getSeasonProgress("s1"),
    {
      ...season,
      own: {
        ...season.own,
        commitments: [
          {
            ...season.own.commitments[0],
            measure: {
              unit: "minutes",
              customLabel: null,
              precision: "decimal",
              target: { direction: "reach", minimum: "ten", ideal: "30" },
              schedule: { period: "weeklyTotal" },
            },
          },
        ],
      },
    },
  ],
  [
    "an unknown cell status",
    (a) => a.getCommitmentProgress("s1", "c1"),
    {
      ...detail,
      weeks: [{ ...detail.weeks[0], cells: [{ ...cell, status: "great" }] }],
    },
  ],
  [
    "evidence that leaks an entry id",
    (a) => a.getCommitmentProgress("s1", "c1"),
    {
      ...detail,
      weeks: [
        {
          ...detail.weeks[0],
          cells: [{ ...cell, evidence: [{ ...cell?.evidence[0], entryId: "e1" }] }],
        },
      ],
    },
  ],
  [
    "an unknown headline",
    (a) => a.getWeekSummary("s1", 3),
    { ...weekSummary(), headline: "worst" },
  ],
  [
    "a member id given as a number",
    (a) => a.getWeekSummary("s1", 3),
    {
      ...weekSummary(),
      circle: [{ memberId: 7, displayName: "Andrea", points: 87 }],
    },
  ],
];

describe("HttpPactJoyApi progress guards", () => {
  it.each(malformed)("rejects a 2xx with %s as Internal, never as data", async (_n, read, data) => {
    await expect(read(apiReturning(data).api)).rejects.toMatchObject({ code: "Internal" });
  });
});
