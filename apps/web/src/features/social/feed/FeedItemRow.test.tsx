import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  completedItemFixture,
  consistentWeekItemFixture,
  encouragementReceivedItemFixture,
  feedMembersFixture,
  reactionsFixture,
  seasonStartedItemFixture,
} from "../../../testing/fixtures/social.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { FeedItemRow } from "./FeedItemRow.tsx";

const members = feedMembersFixture();
const inList = (ui: React.ReactElement) => renderInProviders(<ul>{ui}</ul>);

describe("FeedItemRow", () => {
  it("leads a member's item with their avatar and the Spanish line", () => {
    inList(<FeedItemRow item={completedItemFixture()} members={members} />);
    const row = screen.getByRole("listitem");
    expect(within(row).getByRole("img", { name: "Andrea" })).toHaveTextContent("A");
    expect(within(row).getByText("Andrea completó Correr · 5 km.")).toBeInTheDocument();
  });

  it("says when it happened in a <time>, against the injected clock", () => {
    const now = new Date(2026, 9, 3, 12, 0).getTime();
    const at = new Date(now - 20 * 60_000).toISOString();
    renderInProviders(
      <ul>
        <FeedItemRow item={completedItemFixture({ onDate: "2026-10-03", at })} members={members} />
        <FeedItemRow
          item={seasonStartedItemFixture({ onDate: "2026-08-25", at: null })}
          members={members}
        />
      </ul>,
      { now },
    );
    const [recent, old] = screen.getAllByRole("listitem");
    const recentTime = within(recent as HTMLElement).getByText("hace 20 min");
    expect(recentTime.tagName).toBe("TIME");
    expect(recentTime).toHaveAttribute("datetime", at);
    const oldTime = within(old as HTMLElement).getByText("25 de agosto");
    expect(oldTime).toHaveAttribute("datetime", "2026-08-25");
  });

  it("leads a system item with an icon and no avatar", () => {
    inList(<FeedItemRow item={seasonStartedItemFixture()} members={members} />);
    const row = screen.getByRole("listitem");
    expect(within(row).getByText("Empezó la temporada de 8 semanas.")).toBeInTheDocument();
    expect(within(row).queryByRole("img")).not.toBeInTheDocument();
    expect(row.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("shows the reaction chips only when given a handler, and reports the item and the code", async () => {
    const onReact = vi.fn();
    const item = consistentWeekItemFixture();
    const first = inList(<FeedItemRow item={item} members={members} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    first.unmount();
    inList(<FeedItemRow item={item} members={members} onReact={onReact} />);
    await userEvent.click(screen.getByRole("button", { name: "Fuego" }));
    expect(onReact).toHaveBeenCalledWith(item.key, "fire");
  });

  it("shows no chips on an item that has no reactions (system rows, a received encouragement)", () => {
    inList(<FeedItemRow item={seasonStartedItemFixture()} members={members} onReact={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the received encouragement as one short line", () => {
    inList(
      <FeedItemRow
        item={encouragementReceivedItemFixture()}
        members={members}
        onReact={() => {}}
      />,
    );
    expect(screen.getByText("Andrea te envió 🙌")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("an item of the viewer shows read-only counts, not buttons", () => {
    const own = completedItemFixture({
      memberId: "member-victor",
      reactions: reactionsFixture({
        reactable: false,
        counts: { heart: 1, raisedHands: 0, fire: 0, clap: 0 },
      }),
    } as never);
    inList(<FeedItemRow item={own} members={members} onReact={() => {}} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("list", { name: "Reacciones" })).toBeInTheDocument();
    expect(screen.getByText(/^Completaste/)).toBeInTheDocument();
  });
});
