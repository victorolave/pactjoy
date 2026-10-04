import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { NO_CIRCLE, soloCircleFixture } from "../../../testing/fixtures/circle.ts";
import { renderApp } from "../../../testing/render.tsx";

const EXPIRED_NOW = Date.parse("2026-10-09T12:00:00.000Z");
const NEW_INVITE = {
  code: "9ZXC3V",
  createdAt: "2026-10-09T12:00:00.000Z",
  expiresAt: "2026-10-16T12:00:00.000Z",
};

const circleWith = (
  invite: ReturnType<typeof soloCircleFixture>["circle"] extends infer C
    ? C extends { invite: infer I }
      ? I
      : never
    : never,
) => {
  const base = soloCircleFixture();
  return { ...base, circle: base.circle === null ? null : { ...base.circle, invite } };
};

describe("invite screen (design 5)", () => {
  it("shows the code, when it expires and who it brings into the circle", async () => {
    renderApp({ path: "/circle/invite" });
    expect(await screen.findByText("7K4Q2M")).toBeInTheDocument();
    expect(screen.getByText(/Quien lo use entrará en Andrea & Victor/)).toBeInTheDocument();
    expect(screen.getByText(/Caduca en 5 días/)).toBeInTheDocument();
  });

  it("copies the code on tap and says so", async () => {
    const { deps } = renderApp({ path: "/circle/invite" });
    await userEvent.click(await screen.findByRole("button", { name: "Copiar" }));
    expect(deps.sharing.copied).toEqual(["7K4Q2M"]);
    expect(await screen.findByText("Código copiado.")).toBeInTheDocument();
  });

  it("tells the user when the clipboard refuses", async () => {
    const { deps } = renderApp({ path: "/circle/invite" });
    deps.sharing.copyError = new Error("denied");
    await userEvent.click(await screen.findByRole("button", { name: "Copiar" }));
    expect(await screen.findByText("No pudimos copiar el código.")).toBeInTheDocument();
  });

  it("shares the invite message with the code and its last day (WC-R2)", async () => {
    const { deps } = renderApp({ path: "/circle/invite" });
    await userEvent.click(await screen.findByRole("button", { name: "Compartir" }));
    expect(deps.sharing.shared).toEqual([
      {
        title: "PactJoy",
        text: "Te invito a mi círculo en PactJoy. Código: 7K4Q2M (válido hasta el 8 de octubre)",
      },
    ]);
  });

  it("hides Compartir, and keeps Copiar, where the share sheet does not exist", async () => {
    renderApp({ path: "/circle/invite", canShare: false });
    expect(await screen.findByRole("button", { name: "Copiar" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Compartir" })).not.toBeInTheDocument();
  });

  it("shows an expired code as expired and swaps it for a new one (WC-S2)", async () => {
    const { deps } = renderApp({ path: "/circle/invite", now: EXPIRED_NOW });
    expect(await screen.findByText("Este código ya caducó.")).toBeInTheDocument();
    expect(screen.queryByText("7K4Q2M")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copiar" })).not.toBeInTheDocument();
    deps.api.setMyCircle(circleWith(NEW_INVITE));
    await userEvent.click(screen.getByRole("button", { name: "Nuevo código" }));
    expect(await screen.findByText("9ZXC3V")).toBeInTheDocument();
    expect(deps.api.circleCommands.map((c) => c.method)).toContain("generateInvite");
    expect(screen.getByText(/Caduca en 7 días/)).toBeInTheDocument();
  });

  it("sends one request when Nuevo código is pressed twice in the same tick", async () => {
    const { deps } = renderApp({ path: "/circle/invite", now: EXPIRED_NOW });
    const button = await screen.findByRole("button", { name: "Nuevo código" });
    deps.api.setMyCircle(circleWith(NEW_INVITE));
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText("9ZXC3V")).toBeInTheDocument();
    expect(deps.api.circleCommands.filter((c) => c.method === "generateInvite")).toHaveLength(1);
  });

  it("offers Generar código when the circle never got one", async () => {
    renderApp({ path: "/circle/invite", myCircle: circleWith(null) });
    expect(await screen.findByRole("button", { name: "Generar código" })).toBeInTheDocument();
  });

  it("says there is no connection when a new code cannot be asked for (WC-R11)", async () => {
    const { deps } = renderApp({ path: "/circle/invite" });
    deps.api.failNext("generateInvite", new ApiError("NetworkError", 0, null));
    await userEvent.click(await screen.findByRole("button", { name: "Nuevo código" }));
    expect(await screen.findByText(/Sin conexión/)).toBeInTheDocument();
    expect(screen.getByText("7K4Q2M")).toBeInTheDocument();
  });

  it("goes back to the circle with Listo", async () => {
    const { location } = renderApp({ path: "/circle/invite" });
    await userEvent.click(await screen.findByRole("button", { name: "Listo" }));
    await waitFor(() => expect(location()).toBe("/circle"));
  });

  it("has nothing to invite to without a circle", async () => {
    const { location } = renderApp({
      path: "/circle/invite",
      myCircle: NO_CIRCLE,
      nameDraft: "Victor",
    });
    await waitFor(() => expect(location()).toBe("/circle"));
  });
});
