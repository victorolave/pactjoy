import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NO_CIRCLE } from "../../../testing/fixtures/circle.ts";
import { noCircleTodayFixture } from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const renderStep = (nameDraft?: string) =>
  renderApp({
    path: "/welcome/name",
    today: noCircleTodayFixture(),
    myCircle: NO_CIRCLE,
    ...(nameDraft === undefined ? {} : { nameDraft }),
  });

const field = () => screen.findByRole("textbox", { name: "Tu nombre" });

describe("the name step (design 3)", () => {
  it("keeps the name only on the device and goes on to create a circle", async () => {
    const app = renderStep();
    await userEvent.type(await field(), "  Andrea ");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(app.deps.device.get("nameDraft")).toBe("Andrea");
    expect(app.location()).toBe("/circle/new");
    expect(app.deps.api.calls.createCircle + app.deps.api.calls.joinCircle).toBe(0);
  });

  it("shows the initial of what is typed, with no photo control", async () => {
    renderStep();
    await userEvent.type(await field(), "victor");
    expect(screen.getByRole("img", { name: "victor" })).toHaveTextContent("V");
    expect(screen.queryByText(/foto/i)).not.toBeInTheDocument();
  });

  it("starts from the saved draft, so a reload mid-flow keeps it (OB-S6)", async () => {
    renderStep("Andrea");
    expect(await field()).toHaveValue("Andrea");
  });

  it("refuses 31 characters and stays (OB-S5)", async () => {
    const app = renderStep();
    await userEvent.type(await field(), "a".repeat(31));
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("hasta 30 caracteres");
    expect(app.location()).toBe("/welcome/name");
    expect(app.deps.device.get("nameDraft")).toBeNull();
  });

  it("counts an emoji as one character, like the API", async () => {
    const app = renderStep();
    await userEvent.type(await field(), "🙂".repeat(30));
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(app.location()).toBe("/circle/new");
  });

  it("asks for a name when it is blank, and clears the error as the user types", async () => {
    const app = renderStep();
    await userEvent.type(await field(), "   ");
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Escribe tu nombre.");
    await userEvent.type(screen.getByRole("textbox", { name: "Tu nombre" }), "Ana");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(app.location()).toBe("/welcome/name");
  });

  it("submits with Enter", async () => {
    const app = renderStep();
    await userEvent.type(await field(), "Ana{Enter}");
    expect(app.location()).toBe("/circle/new");
  });
});
