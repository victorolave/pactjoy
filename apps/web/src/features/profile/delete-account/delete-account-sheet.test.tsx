import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { pairCircleFixture } from "../../../testing/fixtures/circle.ts";
import { renderApp } from "../../../testing/render.tsx";

const SETTINGS = "/profile/settings";
const BODY =
  "Se borran tu correo, tu nombre, tus hábitos, notas y fotos, revisiones y avisos. Tus registros se quedan sin tu nombre para que la clasificación de tu círculo no cambie. No se puede deshacer.";

async function openSheet(options: Parameters<typeof renderApp>[0] = {}) {
  const app = renderApp({ path: SETTINGS, myCircle: pairCircleFixture(), ...options });
  await userEvent.click(await screen.findByRole("button", { name: "Eliminar cuenta" }));
  await screen.findByRole("dialog");
  return app;
}

const confirmButton = () => screen.getByRole("button", { name: "Eliminar mi cuenta" });
const typeWord = (text: string) =>
  userEvent.type(screen.getByLabelText("Escribe ELIMINAR para confirmar"), text);

describe("the Eliminar cuenta row (REQ-W1)", () => {
  it("sits below Cerrar sesión and opens the sheet", async () => {
    renderApp({ path: SETTINGS, myCircle: pairCircleFixture() });
    const signOut = await screen.findByRole("button", { name: "Cerrar sesión" });
    const row = screen.getByRole("button", { name: "Eliminar cuenta" });
    expect(signOut.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is disabled offline", async () => {
    renderApp({ path: SETTINGS, myCircle: pairCircleFixture(), online: false });
    expect(await screen.findByRole("button", { name: "Eliminar cuenta" })).toBeDisabled();
  });

  it("is there without a circle too", async () => {
    renderApp({ path: SETTINGS, nameDraft: "Vic" });
    expect(await screen.findByRole("button", { name: "Eliminar cuenta" })).toBeEnabled();
  });
});

describe("DeleteAccountSheet (REQ-W2..W5)", () => {
  it("says what is erased and what stays, with the field and the button", async () => {
    await openSheet();
    expect(screen.getByText(BODY)).toBeInTheDocument();
    const field = screen.getByLabelText("Escribe ELIMINAR para confirmar");
    expect(field).toHaveAttribute("autocapitalize", "characters");
    expect(field).toHaveAttribute("autocomplete", "off");
    expect(field).toHaveAttribute("spellcheck", "false");
    expect(confirmButton()).toBeDisabled();
  });

  it("SC-W1: stays disabled until the word matches, and sends nothing before", async () => {
    const { deps } = await openSheet();
    await typeWord("eliminar");
    expect(confirmButton()).toBeDisabled();
    await userEvent.clear(screen.getByLabelText("Escribe ELIMINAR para confirmar"));
    await typeWord("ELIMINAR ");
    expect(confirmButton()).toBeEnabled();
    expect(deps.api.calls.deleteAccount).toBe(0);
  });

  it("Cancelar closes it and deletes nothing", async () => {
    const { deps } = await openSheet();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deps.api.calls.deleteAccount).toBe(0);
  });

  it("is disabled with the typed word when the connection drops, and says why", async () => {
    const { deps } = await openSheet();
    await typeWord("ELIMINAR");
    deps.connectivity.setOnline(false);
    await waitFor(() => expect(confirmButton()).toBeDisabled());
    expect(screen.getByText("Sin conexión.")).toBeInTheDocument();
  });

  it("while in flight shows Eliminando…, disables the button and cannot be dismissed", async () => {
    const { deps } = await openSheet();
    const release = deps.api.hold("deleteAccount");
    await typeWord("ELIMINAR");
    await userEvent.click(confirmButton());
    expect(await screen.findByRole("button", { name: "Eliminando…" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(deps.api.calls.deleteAccount).toBe(1);
    release();
  });
});

describe("after the answer (REQ-W5, W6, SC-W2)", () => {
  it("success: clears the session and the cache, skips the remote logout and lands on /login with the notice", async () => {
    const { deps } = await openSheet();
    deps.queryClient.setQueryData(["today"], { state: "noSeason" });
    await typeWord("ELIMINAR");
    await userEvent.click(confirmButton());
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByText("Tu cuenta se eliminó")).toBeInTheDocument();
    expect(deps.api.calls.deleteAccount).toBe(1);
    expect(deps.store.load()).toBeNull();
    expect(deps.auth.signedOut).toEqual([]);
    expect(deps.queryClient.getQueryData(["today"])).toBeUndefined();
  });

  it("success: drops this device's push subscription in the browser", async () => {
    const { deps } = await openSheet();
    await waitFor(() => expect(deps.push.device).not.toBeNull());
    await typeWord("ELIMINAR");
    await userEvent.click(confirmButton());
    await screen.findByRole("heading", { name: "Entrar" });
    await waitFor(() => expect(deps.push.device).toBeNull());
  });

  it("failure: shows the error with Reintentar, keeps the typed word and the session, and retry sends the same call", async () => {
    const { deps } = await openSheet();
    deps.api.failNext("deleteAccount", new ApiError("ServiceUnavailable", 503, null));
    await typeWord("ELIMINAR");
    await userEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo eliminar la cuenta");
    expect(screen.getByLabelText("Escribe ELIMINAR para confirmar")).toHaveValue("ELIMINAR");
    expect(deps.store.load()).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByText("Tu cuenta se eliminó")).toBeInTheDocument();
    expect(deps.api.calls.deleteAccount).toBe(2);
  });

  it("any error counts, not only the retryable ones", async () => {
    const { deps } = await openSheet();
    deps.api.failNext("deleteAccount", new ApiError("IdentityUnavailable", 503, null));
    await typeWord("ELIMINAR");
    await userEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo eliminar la cuenta");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeEnabled();
  });

  it("a 401 goes through the expire path: the session expired notice, not the deleted one", async () => {
    const { deps } = await openSheet();
    deps.api.failNext("deleteAccount", new ApiError("Unauthorized", 401, null));
    await typeWord("ELIMINAR");
    await userEvent.click(confirmButton());
    // The fake API does not know the session: the 401 reaches the app as the adapter would report it.
    deps.sessionEvents.expire();
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByText("Tu sesión expiró. Entra de nuevo.")).toBeInTheDocument();
    expect(screen.queryByText("Tu cuenta se eliminó")).not.toBeInTheDocument();
  });
});
