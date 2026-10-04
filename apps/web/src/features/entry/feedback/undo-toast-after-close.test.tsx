import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { activeTodayFixture, weekRowFixture } from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

/**
 * The saved toast's Deshacer is tapped AFTER the sheet that recorded the entry has closed and
 * unmounted. TanStack drops per-call `mutate` callbacks then, which silently ate "Registro deshecho."
 * and the error toast (review WA-W3).
 */
const closeThenUndo = async () => {
  const app = renderApp({
    path: "/?entry=commitment-2",
    today: activeTodayFixture({ rows: [weekRowFixture()] }),
  });
  const dialog = await screen.findByRole("dialog", { name: "Leer" });
  await userEvent.click(within(dialog).getByRole("button", { name: "Registrar 20 min" }));
  await screen.findByText("Registro guardado.");
  await userEvent.click(screen.getByRole("button", { name: "Seguir con mi día" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const toast = await screen.findByRole("status");
  return { app, toast };
};

describe("Deshacer after the sheet closed", () => {
  it("says Registro deshecho. when the delete succeeds", async () => {
    const { app, toast } = await closeThenUndo();
    await userEvent.click(within(toast).getByRole("button", { name: "Deshacer" }));
    await waitFor(() => expect(app.deps.api.deleted).toEqual(["entry-1"]));
    expect(await screen.findByText("Registro deshecho.")).toBeInTheDocument();
  });

  it("shows the error toast with Reintentar when the delete fails, and Reintentar works", async () => {
    const { app, toast } = await closeThenUndo();
    app.deps.api.failNext("deleteEntry", new ApiError("NetworkError", 0, null));
    await userEvent.click(within(toast).getByRole("button", { name: "Deshacer" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No pudimos deshacer el registro.");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(app.deps.api.deleted).toEqual(["entry-1"]));
    expect(await screen.findByText("Registro deshecho.")).toBeInTheDocument();
  });
});
