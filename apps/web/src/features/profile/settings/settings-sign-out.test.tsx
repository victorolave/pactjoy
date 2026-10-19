import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { OutboxItem, OutboxState } from "../../../ports/outbox-store.ts";
import { renderApp } from "../../../testing/render.tsx";

const SETTINGS = "/profile/settings";

const record = (localId: string): OutboxItem => ({
  kind: "record",
  localId,
  attempted: false,
  habitName: "Dibujar",
  command: {
    seasonId: "season-1",
    commitmentId: "commitment-1",
    forDate: "2026-10-02",
    value: { kind: "done" },
    note: null,
    clientRequestId: `req-${localId}`,
  },
});

const queued = (...ids: string[]): OutboxState => ({
  v: 1,
  items: ids.map(record),
  notices: [],
});

const signOut = () => screen.findByRole("button", { name: "Cerrar sesión" });

describe("signing out with entries still on the phone (OE-R6.S2, OE-R6.S3)", () => {
  it("signs out at once when nothing is queued", async () => {
    const { deps } = renderApp({ path: SETTINGS });
    await userEvent.click(await signOut());
    await waitFor(() => expect(deps.auth.signedOut).toHaveLength(1));
  });

  it("sends the queue first when online and signs out without asking once it is empty (OE-R6.S3)", async () => {
    const { deps } = renderApp({ path: SETTINGS, outbox: queued("a", "b"), online: false });
    await signOut();
    // The connection returns and the replay it starts is still in flight when the member signs out.
    const release = deps.api.hold("recordEntry");
    act(() => deps.connectivity.setOnline(true));
    await waitFor(() => expect(deps.api.recordAttempts).toHaveLength(1));
    await userEvent.click(await signOut());
    expect(deps.auth.signedOut).toEqual([]);
    release();
    await waitFor(() => expect(deps.auth.signedOut).toHaveLength(1));
    expect(deps.api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["req-a", "req-b"]);
    expect(screen.queryByText("Tienes registros sin enviar")).not.toBeInTheDocument();
  });

  it("waits no longer than the sign-out grace (2 s) for a send that hangs, then asks", async () => {
    const { deps } = renderApp({ path: SETTINGS, outbox: queued("a", "b"), online: false });
    await signOut();
    const release = deps.api.hold("recordEntry");
    act(() => deps.connectivity.setOnline(true));
    await waitFor(() => expect(deps.api.recordAttempts).toHaveLength(1));
    const started = Date.now();
    await userEvent.click(await signOut());
    await screen.findByRole("dialog", { name: "Tienes registros sin enviar" }, { timeout: 3500 });
    expect(Date.now() - started).toBeLessThan(3000);
    release();
  }, 10_000);

  it("asks first when the entries cannot be sent, naming how many are kept (OE-R6.S2)", async () => {
    const { deps } = renderApp({ path: SETTINGS, outbox: queued("a", "b"), online: false });
    await userEvent.click(await signOut());
    const dialog = await screen.findByRole("dialog", { name: "Tienes registros sin enviar" });
    expect(
      within(dialog).getByText(
        "2 registros guardados en este teléfono todavía no se enviaron. Si cierras sesión, se borrarán.",
      ),
    ).toBeInTheDocument();
    expect(deps.auth.signedOut).toEqual([]);
  });

  it("says it in the singular for one entry", async () => {
    renderApp({ path: SETTINGS, outbox: queued("a"), online: false });
    await userEvent.click(await signOut());
    expect(
      await screen.findByText(
        "1 registro guardado en este teléfono todavía no se envió. Si cierras sesión, se borrará.",
      ),
    ).toBeInTheDocument();
  });

  it("Cancelar keeps the session and both entries", async () => {
    const { deps } = renderApp({ path: SETTINGS, outbox: queued("a", "b"), online: false });
    await userEvent.click(await signOut());
    const dialog = await screen.findByRole("dialog", { name: "Tienes registros sin enviar" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(deps.auth.signedOut).toEqual([]);
    expect(deps.outboxStore.load("user-1").items).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeEnabled();
  });

  it("Cerrar sesión igualmente signs out and clears the outbox", async () => {
    const { deps } = renderApp({ path: SETTINGS, outbox: queued("a", "b"), online: false });
    await userEvent.click(await signOut());
    const dialog = await screen.findByRole("dialog", { name: "Tienes registros sin enviar" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cerrar sesión igualmente" }));
    await waitFor(() => expect(deps.auth.signedOut).toHaveLength(1));
    expect(deps.outboxStore.load("user-1").items).toEqual([]);
    expect(deps.outboxStore.clears).toBeGreaterThanOrEqual(1);
  });

  it("asks too when the send fails online and entries remain", async () => {
    const { deps } = renderApp({ path: SETTINGS, outbox: queued("a"), online: false });
    await signOut();
    // The replay the reconnection starts and the one the sign-out button runs both fail.
    deps.api.failNext("recordEntry", new ApiError("ServiceUnavailable", 503, null));
    deps.api.failNext("recordEntry", new ApiError("ServiceUnavailable", 503, null));
    act(() => deps.connectivity.setOnline(true));
    await waitFor(() => expect(deps.api.recordAttempts).toHaveLength(1));
    await userEvent.click(await signOut());
    expect(
      await screen.findByRole("dialog", { name: "Tienes registros sin enviar" }),
    ).toBeInTheDocument();
    expect(deps.auth.signedOut).toEqual([]);
  });

  it("one last replay runs within the sign-out when the member signs out anyway (OE-R6)", async () => {
    const { deps } = renderApp({ path: SETTINGS, outbox: queued("a"), online: false });
    await signOut();
    // The first two replays (the reconnection, the sign-out button) fail; the third (inside the
    // sign-out itself) goes through, so nothing is lost.
    deps.api.failNext("recordEntry", new ApiError("ServiceUnavailable", 503, null));
    deps.api.failNext("recordEntry", new ApiError("ServiceUnavailable", 503, null));
    act(() => deps.connectivity.setOnline(true));
    await waitFor(() => expect(deps.api.recordAttempts).toHaveLength(1));
    await userEvent.click(await signOut());
    const dialog = await screen.findByRole("dialog", { name: "Tienes registros sin enviar" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Cerrar sesión igualmente" }));
    await waitFor(() => expect(deps.auth.signedOut).toHaveLength(1));
    expect(deps.api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["req-a"]);
  });
});
