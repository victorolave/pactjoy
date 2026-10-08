import { QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../ports/api-error.ts";
import { seasonProgressKey, todayKey } from "../shared/query-keys.ts";
import { FakePactJoyApi } from "../testing/fake-pactjoy-api.ts";
import { activeSeasonProgress } from "../testing/fixtures/season-progress.ts";
import { activeTodayFixture } from "../testing/fixtures/today.ts";
import { createQueryClient } from "./query-client.ts";

function Probe({ api }: { api: FakePactJoyApi }) {
  const today = useQuery({ queryKey: todayKey, queryFn: ({ signal }) => api.getToday(signal) });
  const record = useMutation({
    mutationFn: () =>
      api.recordEntry({
        seasonId: "s-1",
        commitmentId: "c-1",
        value: { kind: "done" },
        note: null,
        clientRequestId: "req-1",
      }),
  });
  return (
    <div>
      <p>state:{today.data?.state ?? (today.isError ? "error" : "loading")}</p>
      <button type="button" onClick={() => record.mutate()}>
        record
      </button>
    </div>
  );
}

describe("createQueryClient", () => {
  it("uses a 30 s stale time, focus refetch and no mutation retries", () => {
    const defaults = createQueryClient().getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(30_000);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
    expect(defaults.mutations?.retry).toBe(0);
  });

  it("retries a query up to twice, and only for transient errors", () => {
    const retry = createQueryClient().getDefaultOptions().queries?.retry;
    if (typeof retry !== "function") throw new Error("retry must be a function");
    const network = new ApiError("NetworkError", 0, null);
    expect(retry(0, network)).toBe(true);
    expect(retry(1, network)).toBe(true);
    expect(retry(2, network)).toBe(false);
    expect(retry(0, new ApiError("WindowClosed", 409, null))).toBe(false);
    expect(retry(0, new Error("boom"))).toBe(false);
  });
});

describe("createQueryClient mutation cache (AC-S3)", () => {
  it("every settled mutation invalidates todayKey, which refetches getToday", async () => {
    const api = new FakePactJoyApi(activeTodayFixture());
    const client = createQueryClient();
    render(
      <QueryClientProvider client={client}>
        <Probe api={api} />
      </QueryClientProvider>,
    );
    await screen.findByText("state:active");
    expect(api.calls.getToday).toBe(1);

    await userEvent.click(screen.getByRole("button", { name: "record" }));

    await waitFor(() => expect(api.calls.getToday).toBe(2));
    expect(api.calls.recordEntry).toBe(1);
  });
});

function Progress({ api }: { api: FakePactJoyApi }) {
  const season = useQuery({
    queryKey: seasonProgressKey("season-1"),
    queryFn: ({ signal }) => api.getSeasonProgress("season-1", signal),
  });
  return <p>progress:{season.data?.state ?? "loading"}</p>;
}

describe("createQueryClient progress invalidation (AC-PG-A03)", () => {
  it("a mutation that settles after its screen unmounted still refetches the progress reads", async () => {
    const api = new FakePactJoyApi(activeTodayFixture());
    api.progress.setSeasonProgress("season-1", activeSeasonProgress());
    const client = createQueryClient();
    const view = (withWriter: boolean) => (
      <QueryClientProvider client={client}>
        <Progress api={api} />
        {withWriter ? <Probe api={api} /> : null}
      </QueryClientProvider>
    );
    const { rerender } = render(view(true));
    await screen.findByText("progress:active");
    const release = api.hold("recordEntry");
    await userEvent.click(screen.getByRole("button", { name: "record" }));

    rerender(view(false));
    release();

    await waitFor(() => expect(api.calls.getSeasonProgress).toBe(2));
  });
});

describe("createQueryClient mutations (P1)", () => {
  it("never pause offline: a write fails at once instead of queueing for later", () => {
    expect(createQueryClient().getDefaultOptions().mutations?.networkMode).toBe("always");
  });
});
