import { readFileSync } from "node:fs";
import { join } from "node:path";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { reactionsFixture } from "../../../testing/fixtures/social.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { ReactionChips } from "./ReactionChips.tsx";

const NAMES = ["Me encanta", "Celebrar", "Fuego", "Aplaudir"];

describe("ReactionChips", () => {
  it("offers the four reactions in the design's order, none pressed", () => {
    renderInProviders(<ReactionChips reactions={reactionsFixture()} onReact={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(4);
    expect(buttons.map((b) => b.textContent)).toEqual(["❤️", "🙌", "🔥", "👏"]);
    for (const [index, button] of buttons.entries()) {
      expect(button).toHaveAccessibleName(NAMES[index] as string);
      expect(button).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("shows a count only when it is above zero and says it to assistive tech", () => {
    renderInProviders(
      <ReactionChips
        reactions={reactionsFixture({ counts: { heart: 2, raisedHands: 0, fire: 1, clap: 0 } })}
        onReact={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Me encanta, 2" })).toHaveTextContent("❤️2");
    expect(screen.getByRole("button", { name: "Fuego, 1" })).toHaveTextContent("🔥1");
    expect(screen.getByRole("button", { name: "Celebrar" })).toHaveTextContent(/^🙌$/);
  });

  it("marks the viewer's reaction as pressed", () => {
    renderInProviders(
      <ReactionChips
        reactions={reactionsFixture({
          counts: { heart: 0, raisedHands: 1, fire: 0, clap: 0 },
          mine: "raisedHands",
        })}
        onReact={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Celebrar, 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Me encanta" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("reacts with the tapped code, changes to another and takes its own back with null", async () => {
    const onReact = vi.fn();
    const first = renderInProviders(
      <ReactionChips reactions={reactionsFixture()} onReact={onReact} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Fuego" }));
    expect(onReact).toHaveBeenLastCalledWith("fire");
    first.unmount();
    renderInProviders(
      <ReactionChips
        reactions={reactionsFixture({
          counts: { heart: 0, raisedHands: 0, fire: 1, clap: 0 },
          mine: "fire",
        })}
        onReact={onReact}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Aplaudir" }));
    expect(onReact).toHaveBeenLastCalledWith("clap");
    await userEvent.click(screen.getByRole("button", { name: "Fuego, 1" }));
    expect(onReact).toHaveBeenLastCalledWith(null);
  });

  it("is disabled offline and says why", () => {
    renderInProviders(<ReactionChips reactions={reactionsFixture()} onReact={() => {}} />, {
      online: false,
    });
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    expect(screen.getByText("Sin conexión: vuelve a conectarte para reaccionar.")).toBeVisible();
  });

  it("disables the buttons while a reaction on the item is pending", () => {
    renderInProviders(<ReactionChips reactions={reactionsFixture()} onReact={() => {}} pending />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
    expect(screen.queryByText(/Sin conexión/)).not.toBeInTheDocument();
  });

  it("shows no buttons on an item that cannot be reacted to, only the counts the owner may read", () => {
    renderInProviders(
      <ReactionChips
        reactions={reactionsFixture({
          reactable: false,
          counts: { heart: 3, raisedHands: 0, fire: 0, clap: 1 },
        })}
        onReact={() => {}}
      />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Reacciones" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual(["❤️3", "👏1"]);
    expect(rows[0]).toHaveAccessibleName("Me encanta, 3");
  });

  it("renders nothing for an item that cannot be reacted to and has no reactions", () => {
    renderInProviders(
      <ReactionChips reactions={reactionsFixture({ reactable: false })} onReact={() => {}} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("keeps a 44 px touch target on the chips", () => {
    const css = readFileSync(join(import.meta.dirname, "reactions.module.css"), "utf8");
    expect(css).toMatch(/\.chip\s*\{[^}]*min-height: var\(--touch-target\)/);
    expect(css).toMatch(/\.chip\s*\{[^}]*min-width: var\(--touch-target\)/);
  });
});
