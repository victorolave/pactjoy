import type { InfiniteData } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../ports/api-error.ts";
import type { CircleFeedDto } from "../../ports/wire.ts";
import { feedKey } from "../../shared/query-keys.ts";
import {
  ANDREA,
  completedItemFixture,
  consistentWeekItemFixture,
  feedFixture,
  nudgeFixture,
  seasonStartedItemFixture,
} from "../../testing/fixtures/social.ts";
import { renderInProviders } from "../../testing/render.tsx";
import { useDismissNudge, useFeed, useReact, useSendEncouragement } from "./queries.ts";

const RUN = completedItemFixture();

function Probe() {
  const feed = useFeed();
  const react = useReact("season-1");
  const send = useSendEncouragement("season-1");
  const dismiss = useDismissNudge("season-1");
  const item = feed.items[0];
  const mine = item !== undefined && "reactions" in item ? item.reactions.mine : "-";
  return (
    <div>
      <p>status:{feed.status}</p>
      <p>items:{feed.items.map((i) => i.key).join(",")}</p>
      <p>mine:{String(mine)}</p>
      <p>nudge:{feed.nudge === null ? "none" : String(feed.nudge.week)}</p>
      <p>more:{String(feed.hasNextPage)}</p>
      <p>reactError:{react.isError ? "yes" : "no"}</p>
      <button type="button" onClick={() => react.mutate({ itemKey: RUN.key, emoji: "heart" })}>
        heart
      </button>
      <button type="button" onClick={() => react.mutate({ itemKey: RUN.key, emoji: null })}>
        unreact
      </button>
      <button type="button" onClick={() => void feed.fetchNextPage()}>
        more
      </button>
      <button
        type="button"
        onClick={() => send.mutate({ recipientId: ANDREA, week: 2, emoji: "raisedHands" })}
      >
        send
      </button>
      <button type="button" onClick={() => dismiss.mutate({ targetId: ANDREA, week: 2 })}>
        dismiss
      </button>
    </div>
  );
}

describe("useFeed", () => {
  it("loads the first page with its members, nudge and cursor", async () => {
    renderInProviders(<Probe />, {
      feedPages: [feedFixture({ items: [RUN], nudge: nudgeFixture() }), feedFixture()],
    });
    expect(await screen.findByText(`items:${RUN.key}`)).toBeInTheDocument();
    expect(screen.getByText("nudge:2")).toBeInTheDocument();
    expect(screen.getByText("more:true")).toBeInTheDocument();
  });

  it("appends the next page when asked, and the nudge stays the first page's", async () => {
    const second = feedFixture({ items: [seasonStartedItemFixture()] });
    renderInProviders(<Probe />, { feedPages: [feedFixture({ items: [RUN] }), second] });
    await screen.findByText(`items:${RUN.key}`);
    await userEvent.click(screen.getByRole("button", { name: "more" }));
    expect(
      await screen.findByText(`items:${RUN.key},${seasonStartedItemFixture().key}`),
    ).toBeInTheDocument();
    expect(screen.getByText("more:false")).toBeInTheDocument();
  });

  it("is an empty list for a circle with no started season", async () => {
    renderInProviders(<Probe />);
    expect(await screen.findByText("status:success")).toBeInTheDocument();
    expect(screen.getByText("items:")).toBeInTheDocument();
  });
});

describe("useReact (optimistic chips)", () => {
  it("shows the reaction at once, before the server answers, and keeps what the server said", async () => {
    const { deps } = renderInProviders(<Probe />, { feedPages: [feedFixture({ items: [RUN] })] });
    await screen.findByText("mine:null");
    const release = deps.api.hold("reactToFeedItem");
    await userEvent.click(screen.getByRole("button", { name: "heart" }));
    expect(await screen.findByText("mine:heart")).toBeInTheDocument();
    expect(deps.api.socialCommands).toHaveLength(1);
    await act(async () => release());
    await waitFor(() => expect(deps.api.calls.feed).toBeGreaterThan(1));
    expect(screen.getByText("mine:heart")).toBeInTheDocument();
  });

  it("takes the reaction back through the remove route", async () => {
    const { deps } = renderInProviders(<Probe />, { feedPages: [feedFixture({ items: [RUN] })] });
    await screen.findByText("mine:null");
    await userEvent.click(screen.getByRole("button", { name: "heart" }));
    await screen.findByText("mine:heart");
    await userEvent.click(screen.getByRole("button", { name: "unreact" }));
    await waitFor(() => expect(screen.getByText("mine:null")).toBeInTheDocument());
    expect(deps.api.calls.removeFeedReaction).toBe(1);
  });

  it("rolls the chip back and reports the error when the server refuses", async () => {
    const { deps } = renderInProviders(<Probe />, { feedPages: [feedFixture({ items: [RUN] })] });
    await screen.findByText("mine:null");
    deps.api.failNext("reactToFeedItem", new ApiError("NetworkError", 0, null));
    const release = deps.api.hold("reactToFeedItem");
    await userEvent.click(screen.getByRole("button", { name: "heart" }));
    expect(await screen.findByText("mine:heart")).toBeInTheDocument();
    await act(async () => release());
    expect(await screen.findByText("mine:null")).toBeInTheDocument();
    expect(screen.getByText("reactError:yes")).toBeInTheDocument();
  });

  it("leaves the other items of the cache untouched", async () => {
    const week = consistentWeekItemFixture();
    const { deps } = renderInProviders(<Probe />, {
      feedPages: [feedFixture({ items: [RUN, week] })],
    });
    await screen.findByText("mine:null");
    await userEvent.click(screen.getByRole("button", { name: "heart" }));
    await waitFor(() => expect(deps.api.calls.reactToFeedItem).toBe(1));
    const cached = deps.queryClient.getQueryData<InfiniteData<CircleFeedDto>>(feedKey);
    expect(cached?.pages[0]?.items[1]).toEqual(week);
  });
});

function TwoItemsProbe() {
  const feed = useFeed();
  const react = useReact("season-1");
  const mineOf = (key: string): string => {
    const item = feed.items.find((candidate) => candidate.key === key);
    return item !== undefined && "reactions" in item ? String(item.reactions.mine) : "-";
  };
  return (
    <div>
      <p>run:{mineOf(RUN.key)}</p>
      <p>week:{mineOf(consistentWeekItemFixture().key)}</p>
      <button type="button" onClick={() => react.mutate({ itemKey: RUN.key, emoji: "heart" })}>
        heart run
      </button>
      <button
        type="button"
        onClick={() => react.mutate({ itemKey: consistentWeekItemFixture().key, emoji: "heart" })}
      >
        heart week
      </button>
    </div>
  );
}

describe("useReact: a refused reaction rolls back only its own item", () => {
  it("keeps the optimistic state of another item reacted to meanwhile", async () => {
    const week = consistentWeekItemFixture();
    const { deps } = renderInProviders(<TwoItemsProbe />, {
      feedPages: [feedFixture({ items: [RUN, week] })],
    });
    await screen.findByText("run:null");
    deps.api.failNext("reactToFeedItem", new ApiError("NetworkError", 0, null));
    const releaseRun = deps.api.hold("reactToFeedItem");
    await userEvent.click(screen.getByRole("button", { name: "heart run" }));
    expect(await screen.findByText("run:heart")).toBeInTheDocument();
    await waitFor(() => expect(deps.api.socialCommands).toHaveLength(1));
    const releaseWeek = deps.api.hold("reactToFeedItem");
    await userEvent.click(screen.getByRole("button", { name: "heart week" }));
    expect(await screen.findByText("week:heart")).toBeInTheDocument();

    // The refetch that follows a settled mutation is held, so the cache is what the rollback left.
    const releaseRefetch = deps.api.hold("feed");
    await act(async () => releaseRun());
    expect(await screen.findByText("run:null")).toBeInTheDocument();
    expect(screen.getByText("week:heart")).toBeInTheDocument();
    await act(async () => {
      releaseRefetch();
      releaseWeek();
    });
  });
});

describe("useSendEncouragement and useDismissNudge", () => {
  it("send calls the API and the nudge leaves the feed after the refetch", async () => {
    const { deps } = renderInProviders(<Probe />, {
      feedPages: [feedFixture({ items: [RUN], nudge: nudgeFixture() })],
    });
    await screen.findByText("nudge:2");
    await userEvent.click(screen.getByRole("button", { name: "send" }));
    await waitFor(() => expect(screen.getByText("nudge:none")).toBeInTheDocument());
    expect(deps.api.socialCommands).toEqual([
      {
        method: "sendEncouragement",
        args: ["season-1", { recipientId: ANDREA, week: 2, emoji: "raisedHands" }],
      },
    ]);
  });

  it("dismiss calls the API and the nudge leaves the feed", async () => {
    const { deps } = renderInProviders(<Probe />, {
      feedPages: [feedFixture({ items: [RUN], nudge: nudgeFixture() })],
    });
    await screen.findByText("nudge:2");
    await userEvent.click(screen.getByRole("button", { name: "dismiss" }));
    await waitFor(() => expect(screen.getByText("nudge:none")).toBeInTheDocument());
    expect(deps.api.calls.dismissNudge).toBe(1);
  });
});
