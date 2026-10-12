import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import { myPauseRequestsFixture } from "../../testing/fixtures/pause.ts";
import { renderInProviders } from "../../testing/render.tsx";
import {
  useCancelPauseRequest,
  useMyPauseRequests,
  useRequestPause,
  useRespondToPause,
  useResumePause,
} from "./queries.ts";

function Probe() {
  const mine = useMyPauseRequests();
  const request = useRequestPause("season-1");
  const respond = useRespondToPause();
  const cancel = useCancelPauseRequest();
  const resume = useResumePause();
  const report = (result: { isError: boolean; error: unknown }) =>
    result.isError && result.error instanceof ApiError ? result.error.code : "";
  return (
    <>
      <p>{`seasonId:${mine.data?.seasonId ?? "-"}`}</p>
      <button
        type="button"
        onClick={() =>
          request.mutate({
            scope: { kind: "all" },
            reason: "work",
            note: null,
            startDate: "2026-10-02",
            endDate: null,
          })
        }
      >
        request
      </button>
      <button type="button" onClick={() => respond.mutate({ id: "pause-9", decision: "approve" })}>
        respond
      </button>
      <button type="button" onClick={() => cancel.mutate("pause-1")}>
        cancel
      </button>
      <button type="button" onClick={() => resume.mutate({ id: "pause-1", commitmentId: "c-1" })}>
        resume
      </button>
      <output>{[request, respond, cancel, resume].map(report).join("")}</output>
    </>
  );
}

/** Read families nothing observes here, so invalidation stays visible on them. */
const FAMILIES = [["today"], ["progress", "season", "season-1"], ["season", "season-1"]] as const;

/** Mounts the probe, scripts the read model, and waits until the probe shows it. */
async function renderProbe() {
  const view = renderInProviders(<Probe />);
  view.deps.api.setMyPauseRequests(myPauseRequestsFixture());
  await view.deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
  await screen.findByText("seasonId:season-1");
  for (const key of FAMILIES) view.deps.queryClient.setQueryData(key, { stale: false });
  const stale = () =>
    FAMILIES.map((key) => view.deps.queryClient.getQueryState(key)?.isInvalidated ?? false);
  return { ...view, stale };
}

describe("pause queries (design D11, task 6.1)", () => {
  it("reads the viewer's pause requests", async () => {
    const { deps } = await renderProbe();
    expect(deps.api.calls.getMyPauseRequests).toBeGreaterThan(0);
  });

  it.each([
    ["request", "requestPause"],
    ["respond", "respondToPause"],
    ["cancel", "cancelPauseRequest"],
    ["resume", "resumePause"],
  ] as const)(
    "%s refetches Today, the pause requests, progress and the season once settled",
    async (label, method) => {
      const { deps, stale } = await renderProbe();
      expect(stale()).toEqual([false, false, false]);
      await userEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(deps.api.calls[method]).toBe(1));
      await waitFor(() => expect(stale()).toEqual([true, true, true]));
    },
  );

  it("refetches even when the mutation fails, so a late answer shows the real state", async () => {
    const { deps, stale } = await renderProbe();
    const reads = deps.api.calls.getMyPauseRequests;
    deps.api.failNext("respondToPause", new ApiError("PauseAlreadyDecided", 409, null));
    await userEvent.click(screen.getByRole("button", { name: "respond" }));
    expect(await screen.findByText("PauseAlreadyDecided")).toBeInTheDocument();
    await waitFor(() => expect(stale()).toEqual([true, true, true]));
    await waitFor(() => expect(deps.api.calls.getMyPauseRequests).toBeGreaterThan(reads));
    expect(deps.api.calls.respondToPause).toBe(1);
  });

  it("retries once on ConcurrencyConflict and succeeds", async () => {
    const { deps } = await renderProbe();
    deps.api.failNext("respondToPause", new ApiError("ConcurrencyConflict", 409, null));
    await userEvent.click(screen.getByRole("button", { name: "respond" }));
    await waitFor(() => expect(deps.api.calls.respondToPause).toBe(2));
    expect(screen.getByRole("status")).toHaveTextContent("");
  });

  it("gives up after the second ConcurrencyConflict, and does not retry other failures", async () => {
    const { deps } = await renderProbe();
    deps.api.failNext("cancelPauseRequest", new ApiError("ConcurrencyConflict", 409, null));
    deps.api.failNext("cancelPauseRequest", new ApiError("ConcurrencyConflict", 409, null));
    await userEvent.click(screen.getByRole("button", { name: "cancel" }));
    expect(await screen.findByText("ConcurrencyConflict")).toBeInTheDocument();
    expect(deps.api.calls.cancelPauseRequest).toBe(2);

    deps.api.failNext("resumePause", new ApiError("PauseNotActive", 409, null));
    await userEvent.click(screen.getByRole("button", { name: "resume" }));
    expect(await screen.findByText(/PauseNotActive/)).toBeInTheDocument();
    expect(deps.api.calls.resumePause).toBe(1);
  });
});
