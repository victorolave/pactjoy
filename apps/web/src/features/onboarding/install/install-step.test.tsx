import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { renderApp } from "../../../testing/render.tsx";

const TITLE = { name: "Ten PactJoy en tu pantalla de inicio" };
const browser = { signedIn: false, installDone: false } as const;

describe("the install step on iOS (OB-R3, OB-S2)", () => {
  const ios = { ...browser, platform: "ios" } as const;

  it("comes after the carousel and before login, with the Share menu instructions", async () => {
    const user = userEvent.setup();
    const app = renderApp({ ...ios, welcomeSeen: false, path: "/welcome" });
    await user.click(await screen.findByRole("button", { name: "Saltar" }));
    expect(await screen.findByRole("heading", TITLE)).toBeInTheDocument();
    expect(app.location()).toBe("/welcome/install");
    expect(screen.getByText("Agregar a pantalla de inicio")).toBeInTheDocument();
    expect(screen.getByText("Compartir")).toBeInTheDocument();
    expect(screen.getByText(/si no lo ves, ábrelo desde el menú/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument();
  });

  it("keeps list semantics and hides the visible numbers from assistive tech", async () => {
    renderApp({ ...ios, path: "/welcome/install" });
    const list = await screen.findByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
    for (const n of ["1", "2", "3"]) {
      expect(within(list).getByText(n)).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("sends a user who has seen the carousel from login to the install step", async () => {
    const app = renderApp({ ...ios, path: "/login" });
    expect(await screen.findByRole("heading", TITLE)).toBeInTheDocument();
    expect(app.location()).toBe("/welcome/install");
  });

  it("is skippable: Continuar goes to login and is not asked again, even after signing out", async () => {
    const user = userEvent.setup();
    const app = renderApp({ ...ios, path: "/welcome/install" });
    await user.click(await screen.findByRole("button", { name: "Continuar" }));
    expect(app.deps.device.get("installStep")).not.toBeNull();
    await waitFor(() => expect(app.location()).toBe("/login"));
    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    app.deps.device.clearSession();
    expect(app.deps.device.get("installStep")).not.toBeNull();
  });

  it("does not appear again once done", async () => {
    const app = renderApp({ ...ios, installDone: true, path: "/login" });
    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    expect(app.location()).toBe("/login");
  });

  it("never appears in an installed app (OB-S2)", async () => {
    const app = renderApp({ ...ios, standalone: true, path: "/login" });
    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    expect(app.location()).toBe("/login");
  });

  it("sends an installed app that opens the step to login", async () => {
    const app = renderApp({ ...ios, standalone: true, path: "/welcome/install" });
    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    expect(app.location()).toBe("/login");
  });
});

describe("the install step where the browser has an install prompt", () => {
  const android = { ...browser, canPrompt: true } as const;

  it("shows Instalar and Ahora no, without the iOS instructions", async () => {
    renderApp({ ...android, path: "/login" });
    expect(await screen.findByRole("heading", TITLE)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Instalar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ahora no" })).toBeInTheDocument();
    expect(screen.queryByText("Agregar a pantalla de inicio")).not.toBeInTheDocument();
  });

  it("shows the prompt only from a tap, then moves on to login", async () => {
    const user = userEvent.setup();
    const app = renderApp({ ...android, path: "/welcome/install" });
    await screen.findByRole("heading", TITLE);
    expect(app.deps.appInstall.prompts).toBe(0);
    await user.click(screen.getByRole("button", { name: "Instalar" }));
    expect(app.deps.appInstall.prompts).toBe(1);
    expect(app.deps.device.get("installStep")).not.toBeNull();
    await waitFor(() => expect(app.location()).toBe("/login"));
  });

  it("moves on when the prompt is dismissed, without blocking", async () => {
    const user = userEvent.setup();
    const app = renderApp({ ...android, path: "/welcome/install" });
    app.deps.appInstall.promptResult = "dismissed";
    await user.click(await screen.findByRole("button", { name: "Instalar" }));
    await waitFor(() => expect(app.location()).toBe("/login"));
  });

  it("moves on when the prompt throws, without an unhandled rejection", async () => {
    const user = userEvent.setup();
    const app = renderApp({ ...android, path: "/welcome/install" });
    app.deps.appInstall.prompt = async () => {
      throw new Error("prompt failed");
    };
    await user.click(await screen.findByRole("button", { name: "Instalar" }));
    expect(app.deps.device.get("installStep")).not.toBeNull();
    await waitFor(() => expect(app.location()).toBe("/login"));
  });

  it("lets Ahora no skip it without showing the prompt", async () => {
    const user = userEvent.setup();
    const app = renderApp({ ...android, path: "/welcome/install" });
    await user.click(await screen.findByRole("button", { name: "Ahora no" }));
    expect(app.deps.appInstall.prompts).toBe(0);
    expect(app.deps.device.get("installStep")).not.toBeNull();
    await waitFor(() => expect(app.location()).toBe("/login"));
  });
});

describe("a browser that cannot install", () => {
  it("skips the step: login straight away (no iOS, no prompt)", async () => {
    const app = renderApp({ ...browser, path: "/login" });
    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    expect(app.location()).toBe("/login");
  });

  it("sends the carousel's last tap on to login", async () => {
    const user = userEvent.setup();
    const app = renderApp({ ...browser, welcomeSeen: false, path: "/welcome" });
    await user.click(await screen.findByRole("button", { name: "Saltar" }));
    await waitFor(() => expect(app.location()).toBe("/login"));
  });
});

describe("the install step and the signed-in flow", () => {
  it("sends a signed-in user who opens the step into the app", async () => {
    const app = renderApp({ platform: "ios", installDone: false, path: "/welcome/install" });
    await waitFor(() => expect(app.location()).toBe("/"));
  });

  it("keeps the post-login name step working", async () => {
    const app = renderApp({ myCircle: { circle: null, season: null }, path: "/welcome/name" });
    expect(
      await screen.findByRole("heading", { name: "¿Cómo te verá tu círculo?" }),
    ).toBeInTheDocument();
    expect(app.location()).toBe("/welcome/name");
  });
});
