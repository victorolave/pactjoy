import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { fakeSession } from "../../testing/fake-auth.ts";
import { renderApp } from "../../testing/render.tsx";

const EMAIL = "andrea@example.com";

async function typeEmailAndSubmit(email: string) {
  await userEvent.type(screen.getByLabelText("Correo"), email);
  await userEvent.click(screen.getByRole("button", { name: "Enviar código" }));
}

async function reachCodeStep() {
  const app = renderApp({ path: "/login", signedIn: false });
  await typeEmailAndSubmit(EMAIL);
  await screen.findByRole("heading", { name: "Escribe tu código" });
  return app;
}

describe("email step (AU-R2)", () => {
  it("asks for the email, then shows the code step for it (AU-S1)", async () => {
    const { deps } = renderApp({ path: "/login", signedIn: false });
    await typeEmailAndSubmit(EMAIL);
    expect(await screen.findByRole("heading", { name: "Escribe tu código" })).toBeInTheDocument();
    expect(deps.auth.requested).toEqual([EMAIL]);
    expect(screen.getByText(EMAIL, { exact: false })).toBeInTheDocument();
  });

  it("trims the email before sending it", async () => {
    const { deps } = renderApp({ path: "/login", signedIn: false });
    await typeEmailAndSubmit(`  ${EMAIL}  `);
    await screen.findByRole("heading", { name: "Escribe tu código" });
    expect(deps.auth.requested).toEqual([EMAIL]);
  });

  it.each(["", "andrea", "andrea@", "andrea@example", "an drea@example.com"])(
    "does not call the port for the invalid email %j",
    async (email) => {
      const { deps } = renderApp({ path: "/login", signedIn: false });
      if (email !== "") await userEvent.type(screen.getByLabelText("Correo"), email);
      await userEvent.click(screen.getByRole("button", { name: "Enviar código" }));
      expect(deps.auth.requested).toEqual([]);
      expect(screen.getByLabelText("Correo")).toHaveAccessibleDescription(
        "Escribe un correo válido.",
      );
      expect(screen.getByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    },
  );

  it("shows the port's failure and stays on the step", async () => {
    const { deps } = renderApp({ path: "/login", signedIn: false });
    deps.auth.failNextWith("RateLimited");
    await typeEmailAndSubmit(EMAIL);
    expect(await screen.findByRole("alert")).toHaveTextContent("Pediste muchos códigos");
    expect(screen.getByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  });

  it("clears the previous error when the next attempt succeeds", async () => {
    const { deps } = renderApp({ path: "/login", signedIn: false });
    deps.auth.failNextWith("Network");
    await typeEmailAndSubmit(EMAIL);
    expect(await screen.findByRole("alert")).toHaveTextContent("conexión");
    await userEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    await screen.findByRole("heading", { name: "Escribe tu código" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("tells the user when the session expired (AU-S6)", async () => {
    const { deps } = renderApp({ path: "/", signedIn: true });
    expect(screen.queryByText("Tu sesión expiró. Entra de nuevo.")).not.toBeInTheDocument();
    act(() => deps.sessionEvents.expire());
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
    expect(screen.getByText("Tu sesión expiró. Entra de nuevo.")).toBeInTheDocument();
    expect(deps.store.load()).toBeNull();
  });
});

describe("code step (AU-R2)", () => {
  it("stores the session and goes to Today after a valid code (AU-S3)", async () => {
    const { deps } = await reachCodeStep();
    deps.auth.session = fakeSession({ userId: "user-5" });
    await userEvent.type(screen.getByLabelText("Código"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Hoy" })).toHaveAttribute("aria-current", "page"),
    );
    expect(deps.store.load()?.userId).toBe("user-5");
    expect(deps.auth.verified).toEqual([{ email: EMAIL, code: "123456" }]);
  });

  it.each(["123", "12345", "12345a", "abcdef"])(
    "does not call the port for the code %j (AU-S2)",
    async (code) => {
      const { deps } = await reachCodeStep();
      await userEvent.type(screen.getByLabelText("Código"), code);
      await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
      expect(deps.auth.verified).toEqual([]);
      expect(screen.getByLabelText("Código")).toHaveAccessibleDescription(
        "El código tiene 6 dígitos.",
      );
    },
  );

  it("shows the error and stays on the step when the code is expired or wrong (AU-S4)", async () => {
    const { deps } = await reachCodeStep();
    await userEvent.type(screen.getByLabelText("Código"), "000000");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("El código no es válido o venció");
    expect(screen.getByRole("heading", { name: "Escribe tu código" })).toBeInTheDocument();
    expect(deps.store.load()).toBeNull();
  });

  it("shows a connection error without losing the typed code", async () => {
    const { deps } = await reachCodeStep();
    deps.auth.failNextWith("Network");
    await userEvent.type(screen.getByLabelText("Código"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("conexión");
    expect(screen.getByLabelText("Código")).toHaveValue("123456");
  });

  it("resends a code to the same email and says so", async () => {
    const { deps } = await reachCodeStep();
    await userEvent.click(screen.getByRole("button", { name: "Reenviar código" }));
    expect(await screen.findByText("Te enviamos un código nuevo.")).toBeInTheDocument();
    expect(deps.auth.requested).toEqual([EMAIL, EMAIL]);
  });

  it("goes back to the email step to change the email", async () => {
    await reachCodeStep();
    await userEvent.click(screen.getByRole("link", { name: "Cambiar correo" }));
    expect(await screen.findByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  });

  it("goes back to the email step when opened without an email", () => {
    renderApp({ path: "/login/code", signedIn: false });
    expect(screen.getByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  });
});
