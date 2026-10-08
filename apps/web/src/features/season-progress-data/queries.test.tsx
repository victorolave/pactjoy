import { focusManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiProvider } from "../../context/api-context.tsx";
import { ClockProvider } from "../../context/clock-context.tsx";
import { FakePactJoyApi } from "../../testing/fake-pactjoy-api.ts";
import {
  activeSeasonProgress,
  commitmentProgress,
  peerMemberProgress,
  weekSummary,
} from "../../testing/fixtures/season-progress.ts";
import {
  useCommitmentProgress,
  useMemberProgress,
  useSeasonProgress,
  useWeekSummary,
} from "./index.ts";

/** 23:59 in Madrid (the fixtures' season zone) on 2026-09-24. */
const BEFORE_MIDNIGHT = Date.parse("2026-09-24T21:59:00Z");

function setup(nowMs = BEFORE_MIDNIGHT) {
  const api = new FakePactJoyApi({ state: "noCircle" });
  api.progress.setSeasonProgress("season-1", activeSeasonProgress());
  api.progress.setMemberProgress("season-1", "member-andrea", peerMemberProgress());
  api.progress.setCommitmentProgress("season-1", "commitment-leer", commitmentProgress());
  api.progress.setWeekSummary("season-1", 3, weekSummary());
  const now = { ms: nowMs };
  // Like the app's client: fresh for 30 s, so focusing alone never refetches in these tests.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  });
  const wrap = (ui: ReactNode) =>
    render(
      <QueryClientProvider client={client}>
        <ApiProvider api={api}>
          <ClockProvider clock={{ nowMs: () => now.ms }}>{ui}</ClockProvider>
        </ApiProvider>
      </QueryClientProvider>,
    );
  return { api, now, wrap };
}

function Reads() {
  const season = useSeasonProgress("season-1");
  const member = useMemberProgress("season-1", "member-andrea");
  const detail = useCommitmentProgress("season-1", "commitment-leer");
  const week = useWeekSummary("season-1", 3);
  return (
    <p>
      {[season, member, detail].map((query) => query.data?.state ?? "-").join(",")}
      {week.data ? ` week ${week.data.weekIndex + 1}` : ""}
    </p>
  );
}

function Season() {
  const season = useSeasonProgress("season-1");
  return <p>{season.data?.state ?? "loading"}</p>;
}

describe("season progress hooks", () => {
  it("read each view with its own arguments", async () => {
    const { api, wrap } = setup();
    wrap(<Reads />);
    expect(await screen.findByText("active,active,active week 4")).toBeInTheDocument();
    expect(api.progress.commands.map((c) => c.args)).toEqual([
      ["season-1"],
      ["season-1", "member-andrea"],
      ["season-1", "commitment-leer"],
      ["season-1", 3],
    ]);
  });
});

describe("season-local day refresh (AC-PG-A05)", () => {
  beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
  afterEach(() => {
    vi.useRealTimers();
    focusManager.setFocused(undefined);
  });

  it("refetches a continuously mounted screen when the season's day ends, without focus", async () => {
    const { api, now, wrap } = setup();
    wrap(<Season />);
    await screen.findByText("active");
    expect(api.calls.getSeasonProgress).toBe(1);

    now.ms += 61_000;
    await act(() => vi.advanceTimersByTimeAsync(62_000));

    await waitFor(() => expect(api.calls.getSeasonProgress).toBe(2));
  });

  it("does not refetch before the boundary", async () => {
    const { api, wrap } = setup();
    wrap(<Season />);
    await screen.findByText("active");
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(api.calls.getSeasonProgress).toBe(1);
  });

  it("catches up on resume when the day changed while the timer was suspended", async () => {
    const { api, now, wrap } = setup(Date.parse("2026-09-24T10:00:00Z"));
    wrap(<Season />);
    await screen.findByText("active");
    act(() => focusManager.setFocused(true));
    expect(api.calls.getSeasonProgress).toBe(1);

    act(() => focusManager.setFocused(false));
    now.ms += 2 * 24 * 60 * 60 * 1000;
    act(() => focusManager.setFocused(true));

    await waitFor(() => expect(api.calls.getSeasonProgress).toBe(2));
  });
});
