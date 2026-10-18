import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { pauseRequestFixture } from "../../../testing/fixtures/pause.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { PendingPauseCard } from "./PendingPauseCard.tsx";

const R1 = pauseRequestFixture({
  startDate: "2026-10-14",
  endDate: null,
  autoApproveAt: "2026-10-16T14:12:00.000Z",
  reason: "health",
  commitments: [{ commitmentId: "c-1", habitName: "Gym", icon: null, resumedOn: null }],
  approvers: [
    { memberId: "m-a", displayName: "Andrea", response: "approve" },
    { memberId: "m-s", displayName: "Sofia", response: null },
  ],
});

const renderCard = (request = R1, options: Parameters<typeof renderInProviders>[1] = {}) =>
  renderInProviders(
    <PendingPauseCard request={request} timeZone="America/Bogota" today="2026-10-14" />,
    options,
  );

describe("the requester's pending view (screen 27, PS-6, PS-7)", () => {
  it("summarises the request and promises the exact auto-approval time (R1)", () => {
    renderCard();
    expect(screen.getByRole("heading", { name: "Pausa en espera" })).toBeInTheDocument();
    expect(screen.getByText("Gym · Salud o lesión")).toBeInTheDocument();
    expect(screen.getByText("Desde hoy, hasta que la reanudes")).toBeInTheDocument();
    expect(
      screen.getByText("Se aprobará automáticamente el viernes 16 a las 9:12."),
    ).toBeInTheDocument();
  });

  it("lists an approver whose account was deleted as a member who left (ADR-0019)", () => {
    renderCard(
      pauseRequestFixture({
        ...R1,
        approvers: [
          { memberId: "m-a", displayName: "Andrea", response: "approve" },
          { memberId: "m-gone", displayName: "", response: null },
        ],
      }),
    );
    expect(screen.getByText(/^Andrea: /)).toBeInTheDocument();
    expect(screen.getByText(/^Miembro que salió: /)).toBeInTheDocument();
  });

  it("explains what happens meanwhile, and after a rejection", () => {
    renderCard();
    expect(
      screen.getByText("Mientras tanto, esos días quedan en espera: no suman ni restan."),
    ).toBeInTheDocument();
  });

  it("PS-6: states what approval and rejection mean, with the start date", () => {
    renderCard();
    expect(screen.getByText("Si se aprueba, se pausan desde hoy.")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Si la rechazan, cuentan con normalidad y podrás registrarlas hasta el final del día siguiente al rechazo.",
      ),
    ).toBeInTheDocument();
  });

  it("PS-6: names the start date when the pause starts later", () => {
    renderCard(pauseRequestFixture({ ...R1, startDate: "2026-10-20" }));
    expect(
      screen.getByText("Si se aprueba, se pausan desde el 20 de octubre."),
    ).toBeInTheDocument();
  });

  it("shows where each approver stands", () => {
    renderCard();
    expect(screen.getByText("Andrea: aprobó")).toBeInTheDocument();
    expect(screen.getByText("Sofia: aún sin responder")).toBeInTheDocument();
  });

  it("lists every Commitment of a Todos request as one item", () => {
    renderCard(
      pauseRequestFixture({
        commitments: [
          { commitmentId: "c-1", habitName: "Gym", icon: null, resumedOn: null },
          { commitmentId: "c-2", habitName: "Leer", icon: null, resumedOn: null },
          { commitmentId: "c-3", habitName: "Correr", icon: null, resumedOn: null },
        ],
      }),
    );
    expect(screen.getByText(/^Gym, Leer y Correr · /)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cancelar solicitud" })).toHaveLength(1);
  });

  it("reads the time in the SEASON's zone, not the device's", () => {
    renderInProviders(<PendingPauseCard request={R1} timeZone="Asia/Kolkata" today="2026-10-14" />);
    expect(
      screen.getByText("Se aprobará automáticamente el viernes 16 a las 19:42."),
    ).toBeInTheDocument();
  });

  describe("cancelling (Q2)", () => {
    it("asks first, saying the days count again and the window is extended", async () => {
      const { deps } = renderCard();
      await userEvent.click(screen.getByRole("button", { name: "Cancelar solicitud" }));
      const dialog = screen.getByRole("dialog", { name: "¿Cancelar la solicitud?" });
      expect(
        within(dialog).getByText(
          "Esos días vuelven a contar y tendrás hasta el final de mañana para registrar lo que quedó en espera.",
        ),
      ).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole("button", { name: "Mantener solicitud" }));
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(deps.api.calls.cancelPauseRequest).toBe(0);
    });

    it("cancels the whole request once confirmed, and closes", async () => {
      const { deps } = renderCard();
      await userEvent.click(screen.getByRole("button", { name: "Cancelar solicitud" }));
      await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar" }));
      await waitFor(() =>
        expect(deps.api.pauseCommands).toEqual([
          { method: "cancelPauseRequest", args: ["pause-1"] },
        ]),
      );
      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    });

    it("tells the user when it was decided meanwhile (PauseAlreadyDecided), and keeps the card honest", async () => {
      const { deps } = renderCard();
      deps.api.failNext("cancelPauseRequest", new ApiError("PauseAlreadyDecided", 409, null));
      await userEvent.click(screen.getByRole("button", { name: "Cancelar solicitud" }));
      await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar" }));
      expect(await screen.findByText("Esta solicitud ya se decidió.")).toBeInTheDocument();
    });

    it("shows a connection failure and allows trying again", async () => {
      const { deps } = renderCard();
      deps.api.failNext("cancelPauseRequest", new ApiError("NetworkError", 0, null));
      await userEvent.click(screen.getByRole("button", { name: "Cancelar solicitud" }));
      await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar" }));
      expect(
        await screen.findByText("No pudimos enviar la solicitud. Revisa tu conexión."),
      ).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "Sí, cancelar" }));
      await waitFor(() => expect(deps.api.calls.cancelPauseRequest).toBe(2));
    });

    it("is off without a connection (no write queue)", () => {
      renderCard(R1, { online: false });
      expect(screen.getByRole("button", { name: "Cancelar solicitud" })).toBeDisabled();
    });
  });
});
