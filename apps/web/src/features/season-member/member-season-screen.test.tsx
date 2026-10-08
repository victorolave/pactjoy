import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { usePactJoyApi } from "../../context/api-context.tsx";
import { ApiError } from "../../ports/api-error.ts";
import type { MemberProgress } from "../../ports/wire.ts";
import { progressRoutePatterns, progressRoutes } from "../../shared/season-progress-routes.ts";
import type { FakePactJoyApi } from "../../testing/fake-pactjoy-api.ts";
import { peerMemberProgress } from "../../testing/fixtures/season-progress.ts";
import { renderInProviders } from "../../testing/render.tsx";
import { MemberSeasonScreen } from "./MemberSeasonScreen.tsx";

const SEASON = "season-1";

/** Scripts the fake before any child mounts, so the first read already has its answer. */
function Scripted({
  script,
  children,
}: {
  readonly script: (api: FakePactJoyApi) => void;
  readonly children: ReactNode;
}) {
  const api = usePactJoyApi() as FakePactJoyApi;
  useState(() => script(api));
  return children;
}

function Where() {
  const { pathname } = useLocation();
  return <p data-testid="where">{pathname}</p>;
}

function open(memberId: string, script: (api: FakePactJoyApi) => void) {
  return renderInProviders(
    <Scripted script={script}>
      <Routes>
        <Route path={progressRoutePatterns.member} element={<MemberSeasonScreen />} />
        <Route path={progressRoutes.overview} element={<Where />} />
      </Routes>
    </Scripted>,
    { path: progressRoutes.member(SEASON, memberId) },
  );
}

/** Andrea by default (fixture), or another peer of the same season. */
const peer = (member = peerMemberProgress().member): MemberProgress => ({
  ...peerMemberProgress(),
  member,
});

describe("MemberSeasonScreen (23d)", () => {
  it("loads the member's season and shows it read-only", async () => {
    open("member-andrea", (api) => api.progress.setMemberProgress(SEASON, "member-andrea", peer()));

    expect(await screen.findByRole("heading", { level: 1, name: "Andrea" })).toBeTruthy();
    expect(screen.getByText("Objetivo privado")).toBeTruthy();
  });

  it("while loading, the region is busy and the way back is already there", async () => {
    let release = () => {};
    open("member-andrea", (api) => {
      api.progress.setMemberProgress(SEASON, "member-andrea", peer());
      release = api.progress.hold("getMemberProgress");
    });

    expect(screen.getByRole("button", { name: "Volver a Temporada" })).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    release();
    expect(await screen.findByRole("heading", { level: 1, name: "Andrea" })).toBeTruthy();
  });

  it("works the same for a peer in a circle of six (no comparison with the viewer)", async () => {
    open("member-elena", (api) =>
      api.progress.setMemberProgress(
        SEASON,
        "member-elena",
        peer({ memberId: "member-elena", displayName: "Elena" }),
      ),
    );

    expect(await screen.findByRole("heading", { level: 1, name: "Elena" })).toBeTruthy();
    expect(screen.queryByText("Victor")).toBeNull();
  });

  it("Volver a Temporada goes to the season overview", async () => {
    open("member-andrea", (api) => api.progress.setMemberProgress(SEASON, "member-andrea", peer()));

    await screen.findByRole("heading", { level: 1, name: "Andrea" });
    await userEvent.click(screen.getByRole("button", { name: "Volver a Temporada" }));
    expect((await screen.findByTestId("where")).textContent).toBe("/season");
  });

  it("the viewer's own season is the overview, not this screen (solo or not)", async () => {
    open("member-victor", (api) =>
      api.progress.setMemberProgress(SEASON, "member-victor", {
        ...peerMemberProgress(),
        member: { memberId: "member-victor", displayName: "Victor" },
        scope: "own",
        commitments: [],
      }),
    );

    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/season"));
  });

  it("a season that has not started yet sends back to the overview", async () => {
    open("member-andrea", (api) =>
      api.progress.setMemberProgress(SEASON, "member-andrea", {
        state: "notStarted",
        seasonId: SEASON,
      }),
    );

    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/season"));
  });

  it.each([
    ["MemberNotFound", 404],
    ["SeasonNotFound", 404],
    ["NotAMember", 403],
    ["InvalidRequest", 400],
  ])("%s is not a connection error: it goes back to the overview", async (code, status) => {
    open("member-andrea", (api) =>
      api.progress.failNext("getMemberProgress", new ApiError(code, status, null)),
    );

    await waitFor(() => expect(screen.getByTestId("where").textContent).toBe("/season"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a failed load shows the 23c message, and Reintentar reads again", async () => {
    open("member-andrea", (api) => {
      api.progress.failNext("getMemberProgress", new ApiError("NetworkError", 0, null));
      api.progress.setMemberProgress(SEASON, "member-andrea", peer());
    });

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("No pudimos cargar la temporada.");
    expect(alert.textContent).toContain("Tus registros están a salvo. Inténtalo de nuevo.");
    await userEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Andrea" })).toBeTruthy();
  });
});
