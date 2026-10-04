import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NO_CIRCLE } from "../../../testing/fixtures/circle.ts";
import { noCircleTodayFixture } from "../../../testing/fixtures/today.ts";
import { MemoryStorage } from "../../../testing/memory-storage.ts";
import { renderApp } from "../../../testing/render.tsx";

const TITLE = { name: "¿Quieres recibir avisos?" };
const NAME_STEP = { name: "¿Cómo te verá tu círculo?" };
const installed = { standalone: true, notificationPermission: "default" } as const;
const newUser = { ...installed, myCircle: NO_CIRCLE, today: noCircleTodayFixture() } as const;

describe("the permission step in an installed app (OB-R4)", () => {
  it("is the first screen after login, before the name step", async () => {
    const app = renderApp(newUser);
    expect(await screen.findByRole("heading", TITLE)).toBeInTheDocument();
    expect(app.location()).toBe("/welcome/notifications");
    expect(app.deps.notifications.requests).toBe(0);
  });

  it("is shown to a member on the first installed launch, once", async () => {
    const user = userEvent.setup();
    const app = renderApp(installed);
    await user.click(await screen.findByRole("button", { name: "Ahora no" }));
    await waitFor(() => expect(app.location()).toBe("/"));
    expect(screen.queryByRole("heading", TITLE)).not.toBeInTheDocument();
  });

  it("asks the browser only from the Activar tap, then goes on to the name step (OB-S3)", async () => {
    const user = userEvent.setup();
    const app = renderApp(newUser);
    await screen.findByRole("heading", TITLE);
    await user.click(screen.getByRole("button", { name: "Activar" }));
    expect(app.deps.notifications.requests).toBe(1);
    expect(app.deps.device.get("notificationStep")).not.toBeNull();
    expect(await screen.findByRole("heading", NAME_STEP)).toBeInTheDocument();
    expect(app.location()).toBe("/welcome/name");
  });

  it("starts the browser's request inside the tap, with nothing awaited before it", async () => {
    const app = renderApp(newUser);
    const activate = await screen.findByRole("button", { name: "Activar" });
    // A synchronous click, and no await before the check: the handler itself must have called it.
    fireEvent.click(activate);
    expect(app.deps.notifications.requests).toBe(1);
  });

  it("does not block when the user denies (OB-S4)", async () => {
    const user = userEvent.setup();
    const app = renderApp(newUser);
    app.deps.notifications.answer = "denied";
    await user.click(await screen.findByRole("button", { name: "Activar" }));
    expect(await screen.findByRole("heading", NAME_STEP)).toBeInTheDocument();
    expect(app.deps.device.get("notificationStep")).not.toBeNull();
  });

  it("lets Ahora no skip it without asking the browser", async () => {
    const user = userEvent.setup();
    const app = renderApp(newUser);
    await user.click(await screen.findByRole("button", { name: "Ahora no" }));
    expect(app.deps.notifications.requests).toBe(0);
    expect(await screen.findByRole("heading", NAME_STEP)).toBeInTheDocument();
  });

  it("does not loop when storage is blocked: Ahora no moves on and the step does not come back", async () => {
    const blocked = new MemoryStorage();
    blocked.setItem = () => {
      throw new Error("blocked");
    };
    const user = userEvent.setup();
    const app = renderApp({ ...installed, deviceStorage: blocked });
    await user.click(await screen.findByRole("button", { name: "Ahora no" }));
    await waitFor(() => expect(app.location()).toBe("/"));
    expect(screen.queryByRole("heading", TITLE)).not.toBeInTheDocument();
  });

  it("is not asked again once done, and the flag survives sign out", async () => {
    const app = renderApp({ ...newUser, notificationStepDone: true });
    expect(await screen.findByRole("heading", NAME_STEP)).toBeInTheDocument();
    app.deps.device.clearSession();
    expect(app.deps.device.get("notificationStep")).not.toBeNull();
  });

  it("does not promise notifications", async () => {
    renderApp(newUser);
    expect(await screen.findByText("Por ahora no enviamos ninguna.")).toBeInTheDocument();
  });
});

describe("when the step does not apply", () => {
  it.each([
    ["a browser tab", { standalone: false, notificationPermission: "default" }],
    ["an unsupported browser", { standalone: true, notificationPermission: "unsupported" }],
    ["a denied permission", { standalone: true, notificationPermission: "denied" }],
    ["a granted permission", { standalone: true, notificationPermission: "granted" }],
  ] as const)("is skipped in %s", async (_name, options) => {
    const app = renderApp({ ...newUser, ...options });
    expect(await screen.findByRole("heading", NAME_STEP)).toBeInTheDocument();
    expect(app.location()).toBe("/welcome/name");
  });

  it("sends a member who opens the screen by hand home when it is not due", async () => {
    const app = renderApp({ path: "/welcome/notifications" });
    await waitFor(() => expect(app.location()).toBe("/"));
  });

  it("is not part of the pre-login flow: a signed-out installed app goes to login", async () => {
    const app = renderApp({ ...installed, signedIn: false, path: "/welcome/notifications" });
    expect(await screen.findByLabelText("Correo")).toBeInTheDocument();
    expect(app.location()).toBe("/login");
  });
});
