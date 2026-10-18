import { readFileSync } from "node:fs";
import { join } from "node:path";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import {
  ANDREA,
  feedFixture,
  feedMembersFixture,
  nudgeFixture,
  PRIVATE_SUBJECT,
} from "../../../testing/fixtures/social.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { NudgeCard } from "./NudgeCard.tsx";

const members = feedMembersFixture();
const feedPages = [feedFixture({ nudge: nudgeFixture() })];
const show = (nudge = nudgeFixture(), options = {}) =>
  renderInProviders(<NudgeCard nudge={nudge} members={members} />, { feedPages, ...options });

describe("NudgeCard (design 31a)", () => {
  it("says who is having a harder time with which habit, and offers encouragement", () => {
    show();
    expect(
      screen.getByText("A Andrea le está costando más Correr estas semanas."),
    ).toBeInTheDocument();
    expect(screen.getByText("¿Quieres enviarle ánimo?")).toBeInTheDocument();
  });

  it("names a private commitment as 'un objetivo privado'", () => {
    show(nudgeFixture({ subject: PRIVATE_SUBJECT }));
    expect(
      screen.getByText("A Andrea le está costando más un objetivo privado estas semanas."),
    ).toBeInTheDocument();
  });

  it("offers nothing for a member whose account was deleted: there is nobody to encourage (ADR-0019)", () => {
    const erased = members.map((m) => (m.id === ANDREA ? { ...m, displayName: "" } : m));
    renderInProviders(<NudgeCard nudge={nudgeFixture()} members={erased} />, { feedPages });
    expect(screen.queryByText(/le está costando más/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar Celebrar" })).not.toBeInTheDocument();
  });

  it("offers the four emojis and 'Ahora no' as a labelled icon button", () => {
    show();
    for (const name of [
      "Enviar Me encanta",
      "Enviar Celebrar",
      "Enviar Fuego",
      "Enviar Aplaudir",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Ahora no" })).toBeInTheDocument();
  });

  it("sends the tapped emoji for the case week to the member, then the card goes away", async () => {
    const { deps } = show();
    await userEvent.click(screen.getByRole("button", { name: "Enviar Celebrar" }));
    await waitFor(() =>
      expect(deps.api.socialCommands).toEqual([
        {
          method: "sendEncouragement",
          args: ["season-1", { recipientId: ANDREA, week: 2, emoji: "raisedHands" }],
        },
      ]),
    );
    await waitFor(() => expect(screen.queryByText(/le está costando más/)).not.toBeInTheDocument());
  });

  it("'Ahora no' dismisses the case, sends nothing and the card goes away", async () => {
    const { deps } = show();
    await userEvent.click(screen.getByRole("button", { name: "Ahora no" }));
    await waitFor(() =>
      expect(deps.api.socialCommands).toEqual([
        { method: "dismissNudge", args: ["season-1", { targetId: ANDREA, week: 2 }] },
      ]),
    );
    await waitFor(() => expect(screen.queryByText(/le está costando más/)).not.toBeInTheDocument());
  });

  it("goes away when the server says the case is already answered", async () => {
    const { deps } = show();
    deps.api.failNext("sendEncouragement", new ApiError("EncouragementAlreadySent", 409, null));
    await userEvent.click(screen.getByRole("button", { name: "Enviar Fuego" }));
    await waitFor(() => expect(screen.queryByText(/le está costando más/)).not.toBeInTheDocument());
  });

  it("keeps the card and says so when the send fails for another reason", async () => {
    const { deps } = show();
    deps.api.failNext("sendEncouragement", new ApiError("NetworkError", 0, null));
    await userEvent.click(screen.getByRole("button", { name: "Enviar Fuego" }));
    expect(
      await screen.findByText("No pudimos enviar el ánimo. Inténtalo de nuevo."),
    ).toBeInTheDocument();
    expect(screen.getByText(/le está costando más/)).toBeInTheDocument();
  });

  it("is disabled offline and says why", () => {
    show(nudgeFixture(), { online: false });
    for (const name of ["Enviar Me encanta", "Enviar Fuego", "Ahora no"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getByText("Sin conexión: vuelve a conectarte para enviar ánimo.")).toBeVisible();
  });

  it("renders nothing for a member the circle does not list", () => {
    renderInProviders(<NudgeCard nudge={nudgeFixture({ targetId: "ghost" })} members={members} />);
    expect(screen.queryByText(/le está costando más/)).not.toBeInTheDocument();
  });

  it("keeps 44 px touch targets on the emoji buttons", () => {
    const css = readFileSync(join(import.meta.dirname, "nudge.module.css"), "utf8");
    expect(css).toMatch(/\.emoji\s*\{[^}]*min-height: var\(--touch-target\)/);
    expect(css).toMatch(/\.emoji\s*\{[^}]*min-width: var\(--touch-target\)/);
  });
});
