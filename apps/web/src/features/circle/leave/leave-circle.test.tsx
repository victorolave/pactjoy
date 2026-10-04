import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { MyCircle } from "../../../ports/pactjoy-api.ts";
import { pairCircleFixture, soloCircleFixture } from "../../../testing/fixtures/circle.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { useMyCircle } from "../queries.ts";
import { LeaveCircleSheet } from "./LeaveCircleSheet.tsx";

function Harness() {
  const { data } = useMyCircle();
  const [open, setOpen] = useState(true);
  if (data?.circle == null) return <p>Sin círculo</p>;
  return (
    <LeaveCircleSheet
      circle={data.circle}
      season={data.season}
      open={open}
      onClose={() => setOpen(false)}
    />
  );
}

const renderSheet = (myCircle: MyCircle = pairCircleFixture(), nameDraft?: string) =>
  renderInProviders(
    <Routes>
      <Route path="/" element={<p>Hoy</p>} />
      <Route path="/ajustes" element={<Harness />} />
    </Routes>,
    { path: "/ajustes", myCircle, ...(nameDraft === undefined ? {} : { nameDraft }) },
  );

const leaveButton = () => screen.findByRole("button", { name: "Salir del círculo" });

describe("leaving the circle (design 40c)", () => {
  it("asks first, naming the circle, and leaves nothing done until confirmed", async () => {
    const { deps } = renderSheet();
    expect(await screen.findByText("¿Salir de Andrea & Victor?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deps.api.calls.leaveCircle).toBe(0);
  });

  it("leaves, refetches Today and the circle, and lands on Today (WC-S10)", async () => {
    const { deps } = renderSheet();
    deps.queryClient.setQueryData(["today"], { state: "noSeason" });
    await userEvent.click(await leaveButton());
    expect(await screen.findByText("Hoy")).toBeInTheDocument();
    expect(deps.api.circleCommands.find((c) => c.method === "leaveCircle")?.args).toEqual([
      "circle-1",
    ]);
    expect(deps.queryClient.getQueryData(["myCircle"])).toEqual({ circle: null, season: null });
    expect(deps.queryClient.getQueryState(["today"])?.isInvalidated).toBe(true);
  });

  it("saves the member's name as the device draft BEFORE the request settles, so a user who left is not sent to the name step", async () => {
    const { deps } = renderSheet(pairCircleFixture());
    expect(deps.device.get("nameDraft")).toBeNull();
    const release = deps.api.hold("leaveCircle");
    await userEvent.click(await leaveButton());
    await waitFor(() => expect(deps.api.calls.leaveCircle).toBe(1));
    expect(deps.device.get("nameDraft")).toBe("Victor");
    release();
    await screen.findByText("Hoy");
    expect(deps.device.get("nameDraft")).toBe("Victor");
  });

  it("replaces an older draft with the name the member had in the circle, to prefill a rejoin", async () => {
    const { deps } = renderSheet(pairCircleFixture(), "Vic");
    await userEvent.click(await leaveButton());
    await screen.findByText("Hoy");
    expect(deps.device.get("nameDraft")).toBe("Victor");
  });

  it("stays in the sheet with the reason when it fails, and the circle is still there", async () => {
    const { deps } = renderSheet();
    deps.api.failNext("leaveCircle", new ApiError("NetworkError", 0, null));
    await userEvent.click(await leaveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Sin conexión");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("Hoy")).not.toBeInTheDocument();
  });

  it("cannot be cancelled or dismissed while the request is in flight", async () => {
    const { deps } = renderSheet();
    const release = deps.api.hold("leaveCircle");
    await userEvent.click(await leaveButton());
    await waitFor(() => expect(deps.api.calls.leaveCircle).toBe(1));
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    release();
    await screen.findByText("Hoy");
  });

  it("leaves once on a double tap", async () => {
    const { deps } = renderSheet();
    await userEvent.dblClick(await leaveButton());
    await screen.findByText("Hoy");
    expect(deps.api.calls.leaveCircle).toBe(1);
  });

  it("tells the last member that the circle is archived", async () => {
    renderSheet(soloCircleFixture());
    expect(await screen.findByText(/el círculo se archiva/)).toBeInTheDocument();
  });
});
