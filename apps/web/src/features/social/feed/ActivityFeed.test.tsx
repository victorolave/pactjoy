import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import {
  completedItemFixture,
  consistentWeekItemFixture,
  emptyFeedFixture,
  encouragementReceivedItemFixture,
  feedFixture,
  seasonStartedItemFixture,
} from "../../../testing/fixtures/social.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { ActivityFeed } from "./ActivityFeed.tsx";

const OLD_START = seasonStartedItemFixture({ onDate: "2026-09-20" });

describe("ActivityFeed", () => {
  it("titles the section and groups the items by day against the device's clock", async () => {
    renderInProviders(<ActivityFeed />, {
      feedPages: [
        feedFixture({
          items: [
            completedItemFixture({ onDate: "2026-10-03" }),
            consistentWeekItemFixture(),
            OLD_START,
          ],
        }),
      ],
    });
    expect(screen.getByRole("heading", { name: "Actividad del círculo" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Hoy" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Esta semana" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Antes" })).toBeInTheDocument();
    const today = screen.getByRole("heading", { name: "Hoy" }).parentElement as HTMLElement;
    expect(within(today).getByText("Andrea completó Correr · 5 km.")).toBeInTheDocument();
    expect(screen.getByText("Andrea: 7 de 7 en Meditar.")).toBeInTheDocument();
    expect(screen.getByText("Empezó la temporada de 8 semanas.")).toBeInTheDocument();
  });

  it("says the circle starts here while no season has started (31b)", async () => {
    renderInProviders(<ActivityFeed />, { feedPages: [emptyFeedFixture()] });
    expect(await screen.findByText("Tu círculo empieza aquí.")).toBeInTheDocument();
    expect(
      screen.getByText("La actividad aparecerá cuando empiece la temporada."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  });

  it("announces the loading state", () => {
    renderInProviders(<ActivityFeed />, { feedPages: [feedFixture()] });
    expect(screen.getByRole("status", { name: "Cargando la actividad" })).toBeInTheDocument();
  });

  it("offers a retry when the feed cannot be read", async () => {
    const { deps } = renderInProviders(<ActivityFeed />, { feedPages: [feedFixture()] });
    deps.api.failNext("feed", new ApiError("NetworkError", 0, null));
    expect(await screen.findByText("No pudimos cargar la actividad.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Andrea completó Correr · 5 km.")).toBeInTheDocument();
  });

  it("loads the next page on 'Cargar más' and drops the button on the last one", async () => {
    const { deps } = renderInProviders(<ActivityFeed />, {
      feedPages: [
        feedFixture({ items: [completedItemFixture()] }),
        feedFixture({ items: [OLD_START] }),
      ],
    });
    await userEvent.click(await screen.findByRole("button", { name: "Cargar más" }));
    expect(await screen.findByText("Empezó la temporada de 8 semanas.")).toBeInTheDocument();
    expect(deps.api.calls.feed).toBe(2);
    expect(screen.queryByRole("button", { name: "Cargar más" })).not.toBeInTheDocument();
  });

  it("reacts to an item with the tapped emoji and shows it pressed at once", async () => {
    const item = completedItemFixture();
    const { deps } = renderInProviders(<ActivityFeed />, {
      feedPages: [feedFixture({ items: [item] })],
    });
    const release = deps.api.hold("reactToFeedItem");
    await userEvent.click(await screen.findByRole("button", { name: "Fuego" }));
    expect(await screen.findByRole("button", { name: "Fuego, 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    release();
    await waitFor(() =>
      expect(deps.api.socialCommands).toEqual([
        { method: "reactToFeedItem", args: ["season-1", item.key, "fire"] },
      ]),
    );
  });

  it("puts the chip back when the reaction fails", async () => {
    const { deps } = renderInProviders(<ActivityFeed />, {
      feedPages: [feedFixture({ items: [completedItemFixture()] })],
    });
    const release = deps.api.hold("reactToFeedItem");
    deps.api.failNext("reactToFeedItem", new ApiError("FeedItemNotReactable", 409, null));
    await userEvent.click(await screen.findByRole("button", { name: "Fuego" }));
    await screen.findByRole("button", { name: "Fuego, 1" });
    release();
    expect(await screen.findByRole("button", { name: "Fuego" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("shows a received encouragement as a line with no chips", async () => {
    renderInProviders(<ActivityFeed />, {
      feedPages: [feedFixture({ items: [encouragementReceivedItemFixture()] })],
    });
    expect(await screen.findByText("Andrea te envió 🙌")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fuego" })).not.toBeInTheDocument();
  });
});
