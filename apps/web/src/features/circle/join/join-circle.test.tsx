import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { NO_CIRCLE, soloCircleFixture } from "../../../testing/fixtures/circle.ts";
import { noCircleTodayFixture } from "../../../testing/fixtures/today.ts";
import { renderApp } from "../../../testing/render.tsx";

const renderJoin = (options: Parameters<typeof renderApp>[0] = {}) =>
  renderApp({
    path: "/circle/join",
    today: noCircleTodayFixture(),
    myCircle: NO_CIRCLE,
    nameDraft: "Victor",
    ...options,
  });

const codeField = () => screen.findByRole("textbox", { name: "Código de invitación" });
const typeCode = async (text = "7K4Q2M") => {
  await userEvent.click(await codeField());
  await userEvent.paste(text);
};
const joinButton = () => screen.getByRole("button", { name: "Unirme al círculo" });
const myName = () => screen.findByRole("textbox", { name: "Tu nombre en el círculo" });

describe("join a circle: the code (design 6a)", () => {
  it("keeps Unirme disabled and calls no API until the sixth character", async () => {
    const { deps } = renderJoin();
    await userEvent.type(await codeField(), "7K4Q2");
    expect(joinButton()).toBeDisabled();
    expect(deps.api.calls.previewInvite).toBe(0);
  });

  it("hints that codes have no 0, O, 1, I or L when such characters are dropped, not for separators", async () => {
    await renderJoin();
    await typeCode("AB0CD1E");
    expect(screen.getByText("Los códigos no usan 0, O, 1, I ni L.")).toBeInTheDocument();
    await typeCode("abc-de");
    expect(screen.queryByText("Los códigos no usan 0, O, 1, I ni L.")).not.toBeInTheDocument();
  });

  it("previews on the sixth character: circle, who invited and how many are in (WC-S3)", async () => {
    const { deps } = renderJoin();
    await typeCode("7k4-q2m");
    expect(await screen.findByText("Los Pactos")).toBeInTheDocument();
    expect(screen.getByText("Te invita Andrea · 2 miembros")).toBeInTheDocument();
    expect(deps.api.circleCommands.find((c) => c.method === "previewInvite")?.args).toEqual([
      "7K4Q2M",
    ]);
    expect(joinButton()).toBeEnabled();
  });

  it("shows only the member count, never 'Creado por', when the inviter has left (IP-R3)", async () => {
    const { deps } = renderJoin();
    deps.api.setPreview({
      circleName: "Los Pactos",
      invitedBy: null,
      activeMemberCount: 1,
      expiresAt: "2026-10-08T12:00:00.000Z",
    });
    await typeCode();
    expect(await screen.findByText("1 miembro")).toBeInTheDocument();
    expect(screen.queryByText(/Te invita|Creado por/)).not.toBeInTheDocument();
  });

  it("prefills the displayName from the device draft and keeps it editable", async () => {
    renderJoin();
    await typeCode();
    expect(await myName()).toHaveValue("Victor");
  });

  it("clears the preview and disables Unirme when the code is edited", async () => {
    renderJoin();
    await typeCode();
    await screen.findByText("Los Pactos");
    await userEvent.keyboard("{Backspace}");
    expect(screen.queryByText("Los Pactos")).not.toBeInTheDocument();
    expect(joinButton()).toBeDisabled();
  });
});

describe("join a circle: joining", () => {
  it("joins, refetches Today and the circle, and lands on the circle (WC-R10)", async () => {
    const { deps, location } = renderJoin();
    await typeCode();
    await userEvent.clear(await myName());
    await userEvent.type(await myName(), "  Vic ");
    deps.api.setMyCircle(soloCircleFixture());
    const release = deps.api.hold("getMyCircle");
    await userEvent.click(joinButton());
    await waitFor(() => expect(deps.api.calls.joinCircle).toBe(1));
    expect(location()).toBe("/circle/join");
    release();
    await waitFor(() => expect(location()).toBe("/circle"));
    expect(deps.api.circleCommands.find((c) => c.method === "joinCircle")?.args).toEqual([
      { inviteCode: "7K4Q2M", displayName: "Vic" },
    ]);
  });

  it("asks for a valid displayName before calling join", async () => {
    const { deps } = renderJoin({ nameDraft: "" });
    await typeCode();
    await userEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Escribe tu nombre.");
    expect(deps.api.calls.joinCircle).toBe(0);
  });

  it("shows a taken displayName under that field and keeps what was typed (WC-S5)", async () => {
    const { deps, location } = renderJoin();
    deps.api.failNext("joinCircle", new ApiError("DisplayNameTaken", 409, null));
    await typeCode();
    await myName();
    await userEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Ese nombre ya lo usa");
    expect(await myName()).toHaveValue("Victor");
    expect(await myName()).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Los Pactos")).toBeInTheDocument();
    expect(location()).toBe("/circle/join");
  });

  it("ignores a second press while joining", async () => {
    const { deps } = renderJoin();
    await typeCode();
    await myName();
    const release = deps.api.hold("joinCircle");
    await userEvent.click(joinButton());
    expect(joinButton()).toBeDisabled();
    release();
    await waitFor(() => expect(deps.api.calls.joinCircle).toBe(1));
  });

  it("shows the offline message and does not navigate (WC-S9)", async () => {
    const { deps, location } = renderJoin();
    deps.api.failNext("joinCircle", new ApiError("NetworkError", 0, null));
    await typeCode();
    await myName();
    await userEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión");
    expect(location()).toBe("/circle/join");
    expect(joinButton()).toBeEnabled();
  });
});

describe("join a circle: errors (design 6b)", () => {
  it.each([
    ["InviteNotFound", 404, "No encontramos ese código"],
    ["InviteExpired", 410, "venció"],
    ["CircleFull", 409, "ya tiene 6 personas"],
    ["CircleArchived", 409, "ya no está activo"],
  ])(
    "%s on preview: message under the boxes, Unirme stays disabled",
    async (code, status, copy) => {
      const { deps } = renderJoin();
      deps.api.failNext("previewInvite", new ApiError(code, status, null));
      await typeCode();
      expect(await screen.findByRole("alert")).toHaveTextContent(copy);
      expect(await codeField()).toHaveAttribute("aria-invalid", "true");
      expect(joinButton()).toBeDisabled();
    },
  );

  it("explains that a season in progress cannot be joined, with no retry (WC-S4)", async () => {
    const { deps } = renderJoin();
    deps.api.failNext("previewInvite", new ApiError("SeasonNotJoinable", 409, null));
    await typeCode();
    expect(await screen.findByRole("alert")).toHaveTextContent("temporada en marcha");
    expect(screen.queryByRole("button", { name: "Reintentar" })).not.toBeInTheDocument();
    expect(deps.api.calls.previewInvite).toBe(1);
  });

  it("clears the error when the code changes and previews the new one", async () => {
    const { deps } = renderJoin();
    deps.api.failNext("previewInvite", new ApiError("InviteNotFound", 404, null));
    await typeCode();
    await screen.findByRole("alert");
    await userEvent.keyboard("{Backspace}N");
    expect(await screen.findByText("Los Pactos")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says they already belong when the code is their own circle's (WC-S6)", async () => {
    const { deps } = renderJoin({ myCircle: soloCircleFixture() });
    deps.api.failNext("previewInvite", new ApiError("AlreadyInActiveCircle", 409, null));
    await typeCode("7K4Q2M");
    expect(await screen.findByRole("alert")).toHaveTextContent("Ya formas parte de este círculo.");
    expect(screen.getByRole("link", { name: "Ir al círculo" })).toHaveAttribute("href", "/circle");
  });

  it("says to leave the current circle first when the code is another one's (WC-S6)", async () => {
    const { deps } = renderJoin({ myCircle: soloCircleFixture() });
    deps.api.failNext("previewInvite", new ApiError("AlreadyInActiveCircle", 409, null));
    await typeCode("ABCDEF");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sal de él antes de unirte");
    expect(screen.queryByRole("link", { name: "Ir al círculo" })).not.toBeInTheDocument();
  });

  it("offers Reintentar when the preview fails offline, and previews again (WC-S9)", async () => {
    const { deps } = renderJoin();
    deps.api.failNext("previewInvite", new ApiError("NetworkError", 0, null));
    await typeCode();
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Los Pactos")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows Sin conexión instead of searching forever when the browser is offline (WC-S9)", async () => {
    const { deps } = renderJoin({ online: false });
    await codeField();
    // TanStack listens for the event only once a query is mounted, so go offline after rendering.
    window.dispatchEvent(new Event("offline"));
    try {
      deps.api.failNext("previewInvite", new ApiError("NetworkError", 0, null));
      await typeCode();
      expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión");
    } finally {
      window.dispatchEvent(new Event("online"));
    }
  });

  it("shows a join that fails with a code error under the boxes, keeping the preview", async () => {
    const { deps, location } = renderJoin();
    deps.api.failNext("joinCircle", new ApiError("CircleFull", 409, null));
    await typeCode();
    await myName();
    await userEvent.click(joinButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("ya tiene 6 personas");
    expect(location()).toBe("/circle/join");
  });
});

describe("join a circle: getting here and back", () => {
  it("is reached from 'Tengo un código' on the create screen", async () => {
    renderApp({ path: "/circle/new", today: noCircleTodayFixture(), myCircle: NO_CIRCLE });
    await userEvent.click(await screen.findByRole("link", { name: "Tengo un código" }));
    expect(await screen.findByRole("heading", { name: "Únete con un código" })).toBeInTheDocument();
  });

  it("goes Back to where it came from", async () => {
    const { location } = renderApp({
      path: "/circle/new",
      today: noCircleTodayFixture(),
      myCircle: NO_CIRCLE,
    });
    await userEvent.click(await screen.findByRole("link", { name: "Tengo un código" }));
    await userEvent.click(await screen.findByRole("button", { name: "Volver" }));
    await waitFor(() => expect(location()).toBe("/circle/new"));
  });
});
