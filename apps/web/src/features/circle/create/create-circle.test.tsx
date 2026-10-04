import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { NO_CIRCLE, soloCircleFixture } from "../../../testing/fixtures/circle.ts";
import { noCircleTodayFixture, noSeasonTodayFixture } from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const renderCreate = (nameDraft = "Andrea") =>
  renderApp({
    path: "/circle/new",
    today: noCircleTodayFixture(),
    myCircle: NO_CIRCLE,
    nameDraft,
  });

const circleName = () => screen.findByRole("textbox", { name: "Nombre del círculo" });
const myName = () => screen.getByRole("textbox", { name: "Tu nombre en el círculo" });
const submit = () => userEvent.click(screen.getByRole("button", { name: "Crear círculo" }));

describe("create circle (design 4)", () => {
  it("says 1 to 6 people, never 2: a solo circle is valid", async () => {
    renderCreate();
    await circleName();
    expect(screen.getByText(/De 1 a 6 personas/)).toBeInTheDocument();
    expect(screen.queryByText(/De 2 a 6/)).not.toBeInTheDocument();
  });

  it("prefills the displayName from the device draft and keeps it editable (WC-S1)", async () => {
    renderCreate("Andrea");
    await circleName();
    expect(myName()).toHaveValue("Andrea");
    await userEvent.clear(myName());
    await userEvent.type(myName(), "Ana");
    expect(myName()).toHaveValue("Ana");
  });

  it("creates the circle, then its invite, and refetches Today and the circle before leaving", async () => {
    const { deps, location } = renderCreate();
    await userEvent.type(await circleName(), " Andrea & Victor ");
    deps.api.setMyCircle(soloCircleFixture());
    await submit();
    await waitFor(() => expect(location()).toBe("/circle"));
    expect(deps.api.circleCommands.map((c) => c.method)).toEqual([
      "getMyCircle",
      "createCircle",
      "generateInvite",
      "getMyCircle",
    ]);
    expect(deps.api.circleCommands[1]?.args).toEqual([
      { name: "Andrea & Victor", displayName: "Andrea" },
    ]);
    expect(deps.api.circleCommands[2]?.args).toEqual(["circle-1"]);
  });

  it("makes Today show the new circle, not the old noCircle (TO-S15)", async () => {
    const { deps, location } = renderCreate();
    await userEvent.type(await circleName(), "Los Pactos");
    deps.api.setMyCircle(soloCircleFixture());
    deps.api.setToday(noSeasonTodayFixture());
    await submit();
    await waitFor(() => expect(location()).toBe("/circle"));
    await userEvent.click(screen.getByRole("link", { name: "Hoy" }));
    expect(
      await screen.findByRole("heading", { name: "Todavía no hay temporada" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Los de siempre")).toBeInTheDocument();
  });

  it("does not navigate until the refetch has landed, so no stale noCircle shows", async () => {
    const { deps, location } = renderCreate();
    await userEvent.type(await circleName(), "Los Pactos");
    deps.api.setMyCircle(soloCircleFixture());
    const releaseRefetch = deps.api.hold("getMyCircle");
    await submit();
    await waitFor(() => expect(deps.api.calls.generateInvite).toBe(1));
    await waitFor(() => expect(deps.api.calls.getMyCircle).toBe(2));
    expect(location()).toBe("/circle/new");
    releaseRefetch();
    await waitFor(() => expect(location()).toBe("/circle"));
  });

  it("still lands on the circle when only the invite fails: the circle exists", async () => {
    const { deps, location } = renderCreate();
    deps.api.failNext("generateInvite", new ApiError("Internal", 500, null));
    await userEvent.type(await circleName(), "Los Pactos");
    deps.api.setMyCircle(soloCircleFixture());
    await submit();
    await waitFor(() => expect(location()).toBe("/circle"));
  });

  it("goes to the circle when the server says they are already in one (a retried, landed create)", async () => {
    const { deps, location } = renderCreate();
    deps.api.failNext("createCircle", new ApiError("AlreadyInActiveCircle", 409, null));
    await userEvent.type(await circleName(), "Los Pactos");
    deps.api.setMyCircle(soloCircleFixture());
    await submit();
    await waitFor(() => expect(location()).toBe("/circle"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ignores a second press while the circle is being created", async () => {
    const { deps } = renderCreate();
    await userEvent.type(await circleName(), "Los Pactos");
    const release = deps.api.hold("createCircle");
    await submit();
    expect(screen.getByRole("button", { name: "Crear círculo" })).toBeDisabled();
    await userEvent.type(myName(), "{Enter}");
    release();
    await waitFor(() => expect(deps.api.calls.createCircle).toBe(1));
  });

  it("asks for a circle name and a valid displayName before calling the API", async () => {
    const { deps } = renderCreate("");
    await circleName();
    await submit();
    const alerts = screen.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Ponle un nombre al círculo."),
        expect.stringContaining("Escribe tu nombre."),
      ]),
    );
    expect(deps.api.calls.createCircle).toBe(0);
  });

  it("shows a taken displayName under that field and keeps what was typed (WC-S5)", async () => {
    const { deps, location } = renderCreate();
    deps.api.failNext("createCircle", new ApiError("DisplayNameTaken", 409, null));
    await userEvent.type(await circleName(), "Los Pactos");
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Ese nombre ya lo usa");
    expect(myName()).toHaveValue("Andrea");
    expect(myName()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("textbox", { name: "Nombre del círculo" })).toHaveValue("Los Pactos");
    expect(location()).toBe("/circle/new");
  });

  it("shows the offline message and stays when the network is down (WC-S9)", async () => {
    const { deps, location } = renderCreate();
    deps.api.failNext("createCircle", new ApiError("NetworkError", 0, null));
    await userEvent.type(await circleName(), "Los Pactos");
    await submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión");
    expect(location()).toBe("/circle/new");
    expect(deps.api.calls.generateInvite).toBe(0);
  });

  it("offers the way to join with a code", async () => {
    renderCreate();
    await circleName();
    expect(screen.getByRole("link", { name: "Tengo un código" })).toHaveAttribute(
      "href",
      "/circle/join",
    );
  });
});
