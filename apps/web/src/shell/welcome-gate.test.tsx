import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../testing/render.tsx";

const FIRST = "Elige una meta. Invita a alguien. Avancen a su manera.";
const LOGIN = { name: "Correo" };
const fresh = { signedIn: false, welcomeSeen: false } as const;

describe("WelcomeGate and the carousel (OB-R2, OB-S1)", () => {
  it("shows the carousel before login to a browser that has not seen it", async () => {
    const app = renderApp({ ...fresh, path: "/login" });
    expect(await screen.findByRole("heading", { name: FIRST })).toBeInTheDocument();
    expect(app.location()).toBe("/welcome");
    expect(screen.getByRole("img", { name: "Pantalla 1 de 3" })).toBeInTheDocument();
  });

  it("says circles are from 1 to 6 people, never that a solo circle is incomplete (OB-R7)", async () => {
    renderApp({ ...fresh, path: "/welcome" });
    expect(await screen.findByText(/de 1 a 6 personas/)).toBeInTheDocument();
  });

  it("walks the three slides with Siguiente and finishes with Empezar, which marks it seen", async () => {
    const user = userEvent.setup();
    const app = renderApp({ ...fresh, path: "/welcome" });
    await user.click(await screen.findByRole("button", { name: "Siguiente" }));
    expect(
      screen.getByRole("heading", { name: "Metas distintas, la misma cuenta." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pantalla 2 de 3" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(
      screen.getByRole("heading", { name: "Compite contigo. Juega con otros." }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Saltar" })).not.toBeInTheDocument();
    expect(app.deps.device.get("welcomeSeen")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Empezar" }));
    expect(app.deps.device.get("welcomeSeen")).not.toBeNull();
    await waitFor(() => expect(app.location()).toBe("/login"));
    expect(await screen.findByLabelText(LOGIN.name)).toBeInTheDocument();
  });

  it("lets Saltar leave from the first slide, and marks it seen too", async () => {
    const user = userEvent.setup();
    const app = renderApp({ ...fresh, path: "/welcome" });
    await user.click(await screen.findByRole("button", { name: "Saltar" }));
    expect(app.deps.device.get("welcomeSeen")).not.toBeNull();
    await waitFor(() => expect(app.location()).toBe("/login"));
  });

  it("does not bring the carousel back once it was seen, even after signing out", async () => {
    const app = renderApp({ signedIn: false, welcomeSeen: true, path: "/login" });
    expect(await screen.findByLabelText(LOGIN.name)).toBeInTheDocument();
    expect(app.location()).toBe("/login");
    app.deps.device.clearSession();
    expect(app.deps.device.get("welcomeSeen")).not.toBeNull();
  });

  it("skips the carousel in an installed app: straight to login (D9)", async () => {
    const app = renderApp({ ...fresh, standalone: true, path: "/login" });
    expect(await screen.findByLabelText(LOGIN.name)).toBeInTheDocument();
    expect(app.location()).toBe("/login");
  });

  it("sends an installed app that opens /welcome to login", async () => {
    const app = renderApp({ ...fresh, standalone: true, path: "/welcome" });
    expect(await screen.findByLabelText(LOGIN.name)).toBeInTheDocument();
    expect(app.location()).toBe("/login");
  });

  it("sends a signed-in user who opens /welcome into the app (OB-S8)", async () => {
    const app = renderApp({ welcomeSeen: false, path: "/welcome" });
    await waitFor(() => expect(app.location()).toBe("/"));
  });
});
