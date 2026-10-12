import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { MyPauseRequests } from "../../../ports/wire.ts";
import { myPauseRequestsFixture, pauseRequestFixture } from "../../../testing/fixtures/pause.ts";
import { MemoryStorage } from "../../../testing/memory-storage.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { RedistributedBanner } from "./RedistributedBanner.tsx";

const request = (names: readonly string[], id = "pause-1") =>
  pauseRequestFixture({
    id,
    status: "approved",
    commitments: names.map((habitName, index) => ({
      commitmentId: `c-${index + 1}`,
      habitName,
      icon: null,
      resumedOn: null,
    })),
  });

const view = (
  names: readonly string[],
  total: { before: number; after: number },
  commitments: readonly { before: number; after: number }[],
  id = "pause-1",
): MyPauseRequests =>
  myPauseRequestsFixture({
    mine: [request(names, id)],
    redistributed: {
      pauseRequestId: id,
      total,
      commitments: commitments.map((c, index) => ({ commitmentId: `c-${index + 1}`, ...c })),
    },
  });

async function open(data: MyPauseRequests, deviceStorage = new MemoryStorage()) {
  const rendered = renderInProviders(<RedistributedBanner />, { deviceStorage });
  rendered.deps.api.setMyPauseRequests(data);
  await rendered.deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
  return { ...rendered, deviceStorage };
}

const SINGLE = view("Gym".split(","), { before: 397, after: 400 }, [{ before: 90, after: 93 }]);

describe("the 'points redistributed' notice (screen 30b, PS-14, PS-15)", () => {
  it("says what changed for one Commitment, with the viewer's total", async () => {
    await open(SINGLE);
    expect(await screen.findByText("Los puntos se recalcularon")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Al pausar Gym, sus puntos pasaron de 90 a 93. Tu total subió de 397 a 400.",
      ),
    ).toBeInTheDocument();
  });

  it("says the total went down, or stayed", async () => {
    const down = await open(
      view(["Gym"], { before: 400, after: 397 }, [{ before: 93, after: 90 }]),
    );
    expect(await screen.findByText(/Tu total bajó de 400 a 397\./)).toBeInTheDocument();
    down.unmount();
    await open(view(["Gym"], { before: 400, after: 400 }, [{ before: 93, after: 90 }]));
    expect(await screen.findByText(/Tu total se mantiene en 400\./)).toBeInTheDocument();
  });

  it("lists every Commitment of a Todos request in generic wording", async () => {
    await open(
      view(["Gym", "Leer", "Correr"], { before: 500, after: 510 }, [
        { before: 10, after: 12 },
        { before: 20, after: 22 },
        { before: 30, after: 31 },
      ]),
    );
    expect(
      await screen.findByText(
        "Tu pausa cubre Gym, Leer y Correr: sus puntos se redistribuyeron entre las oportunidades que siguen activas. Tu total subió de 500 a 510.",
      ),
    ).toBeInTheDocument();
  });

  it("shows once per request on this device: it stays while open, then not on the next open (PS-S3)", async () => {
    const storage = new MemoryStorage();
    const first = await open(SINGLE, storage);
    expect(await screen.findByText("Los puntos se recalcularon")).toBeInTheDocument();
    expect(first.deps.device.get("pause-redistributed-seen:pause-1")).toBe("1");
    // Another read while the screen is still open does not take it away.
    await first.deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
    expect(screen.getByText("Los puntos se recalcularon")).toBeInTheDocument();
    first.unmount();

    const second = await open(SINGLE, storage);
    await waitFor(() => expect(second.deps.api.calls.getMyPauseRequests).toBeGreaterThan(0));
    expect(screen.queryByText("Los puntos se recalcularon")).not.toBeInTheDocument();
  });

  it("shows again when the flag is cleared, and on another device", async () => {
    const storage = new MemoryStorage();
    const first = await open(SINGLE, storage);
    await screen.findByText("Los puntos se recalcularon");
    first.deps.device.remove("pause-redistributed-seen:pause-1");
    first.unmount();
    const cleared = await open(SINGLE, storage);
    expect(await screen.findByText("Los puntos se recalcularon")).toBeInTheDocument();
    cleared.unmount();
    await open(SINGLE, new MemoryStorage());
    expect(await screen.findByText("Los puntos se recalcularon")).toBeInTheDocument();
  });

  it("is per request: a later approved request shows its own notice", async () => {
    const storage = new MemoryStorage();
    const first = await open(SINGLE, storage);
    await screen.findByText("Los puntos se recalcularon");
    first.unmount();
    await open(
      view(["Leer"], { before: 400, after: 405 }, [{ before: 50, after: 55 }], "pause-2"),
      storage,
    );
    expect(await screen.findByText(/Al pausar Leer/)).toBeInTheDocument();
  });

  it("goes away when dismissed", async () => {
    await open(SINGLE);
    await userEvent.click(await screen.findByRole("button", { name: "Entendido" }));
    expect(screen.queryByText("Los puntos se recalcularon")).not.toBeInTheDocument();
  });

  it("shows nothing when the pause changed no points, and does not use up the flag", async () => {
    const unchanged = view(["Gym"], { before: 400, after: 400 }, [{ before: 90, after: 90 }]);
    const { deps } = await open(unchanged);
    await waitFor(() => expect(deps.api.calls.getMyPauseRequests).toBeGreaterThan(0));
    expect(screen.queryByText("Los puntos se recalcularon")).not.toBeInTheDocument();
    expect(deps.device.get("pause-redistributed-seen:pause-1")).toBeNull();
  });

  it("shows nothing without an approved request (pending, rejected or cancelled never redistribute)", async () => {
    const { deps } = await open(myPauseRequestsFixture({ mine: [request(["Gym"])] }));
    await waitFor(() => expect(deps.api.calls.getMyPauseRequests).toBeGreaterThan(0));
    expect(screen.queryByText("Los puntos se recalcularon")).not.toBeInTheDocument();
  });

  it("falls back to generic wording if the request is not in the list", async () => {
    await open(
      myPauseRequestsFixture({
        redistributed: {
          pauseRequestId: "pause-7",
          total: { before: 1, after: 2 },
          commitments: [{ commitmentId: "c-1", before: 1, after: 2 }],
        },
      }),
    );
    expect(
      await screen.findByText(/Tu pausa cubre tus compromisos: sus puntos se redistribuyeron/),
    ).toBeInTheDocument();
  });
});
