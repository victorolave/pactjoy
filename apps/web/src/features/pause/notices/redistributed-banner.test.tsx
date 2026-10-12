import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import type { MyPauseRequests } from "../../../ports/wire.ts";
import { myCircleKey } from "../../../shared/query-keys.ts";
import { pairCircleFixture, soloCircleFixture } from "../../../testing/fixtures/circle.ts";
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
  commitments: readonly {
    before: number;
    after: number;
    weightPoints?: number;
    opportunities?: { before: number; after: number };
  }[],
  id = "pause-1",
): MyPauseRequests =>
  myPauseRequestsFixture({
    mine: [request(names, id)],
    redistributed: {
      pauseRequestId: id,
      total,
      commitments: commitments.map((c, index) => ({
        commitmentId: `c-${index + 1}`,
        weightPoints: 300,
        opportunities: { before: 26, after: 24 },
        ...c,
      })),
    },
  });

async function open(
  data: MyPauseRequests,
  deviceStorage = new MemoryStorage(),
  myCircle = soloCircleFixture(),
) {
  const rendered = renderInProviders(<RedistributedBanner />, { deviceStorage, myCircle });
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
        "La pausa de Gym repartió el valor de sus oportunidades entre las que quedan: cada una vale ahora 300 ÷ 24. Tu total subió de 397 a 400.",
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
    expect(await screen.findByText(/La pausa de Leer repartió/)).toBeInTheDocument();
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
          commitments: [
            {
              commitmentId: "c-1",
              before: 1,
              after: 2,
              weightPoints: 300,
              opportunities: { before: 26, after: 24 },
            },
          ],
        },
      }),
    );
    expect(
      await screen.findByText(/Tu pausa cubre tus compromisos: sus puntos se redistribuyeron/),
    ).toBeInTheDocument();
  });
  it("shows the per-opportunity value unreduced, and keeps the old lead when nothing remains", async () => {
    await open(view(["Gym"], { before: 397, after: 400 }, [{ before: 90, after: 93 }]));
    expect(await screen.findByText(/cada una vale ahora 300 ÷ 24\./)).toBeInTheDocument();

    cleanup();
    await open(
      view(["Gym"], { before: 397, after: 400 }, [
        { before: 90, after: 93, opportunities: { before: 26, after: 0 } },
      ]),
      new MemoryStorage(),
    );
    expect(
      await screen.findByText(/Al pausar Gym, sus puntos pasaron de 90 a 93\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/÷/)).not.toBeInTheDocument();
  });

  it("shows no ÷ for Todos", async () => {
    await open(
      view(["Gym", "Leer"], { before: 500, after: 510 }, [
        { before: 1, after: 2 },
        { before: 3, after: 4 },
      ]),
    );
    expect(await screen.findByText(/Tu pausa cubre Gym y Leer/)).toBeInTheDocument();
    expect(screen.queryByText(/÷/)).not.toBeInTheDocument();
  });

  describe("the peers sentence", () => {
    const peers = (names: readonly string[]) => {
      const base = pairCircleFixture();
      if (base.circle === null) throw new Error("fixture has a circle");
      const you = base.circle.members.filter((m) => m.isYou);
      return {
        ...base,
        circle: {
          ...base.circle,
          members: [
            ...names.map((displayName, index) => ({
              id: `m-${index}`,
              displayName,
              joinedAt: "2026-09-27T12:00:00.000Z",
              isYou: false,
            })),
            ...you,
          ],
        },
      };
    };

    it.each([
      [["Andrea"], "El de Andrea no cambia."],
      [["Ana", "Beto", "Carla"], "Los de Ana, Beto y Carla no cambian."],
      [["Ana", "Beto", "Carla", "Dani", "Eva"], "El de los demás no cambia."],
    ])("ends with the peers of %j", async (names, sentence) => {
      await open(SINGLE, new MemoryStorage(), peers(names));
      expect(
        await screen.findByText(new RegExp(`${sentence.replace(".", "\\.")}$`)),
      ).toBeInTheDocument();
    });

    it("is omitted in a solo circle, and when the circle read fails", async () => {
      await open(SINGLE);
      expect(await screen.findByText(/Tu total subió de 397 a 400\.$/)).toBeInTheDocument();
      cleanup();

      const failing = renderInProviders(<RedistributedBanner />, {
        myCircle: pairCircleFixture(),
        myCircleFailures: [new ApiError("Internal", 500, null)],
      });
      failing.deps.api.setMyPauseRequests(SINGLE);
      await failing.deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
      expect(await screen.findByText(/Tu total subió de 397 a 400\.$/)).toBeInTheDocument();
    });

    it("waits for the circle: the text includes the peers and the flag is written once", async () => {
      const { deps } = renderInProviders(<RedistributedBanner />, {
        myCircle: pairCircleFixture(),
      });
      await waitFor(() => expect(deps.api.calls.getMyCircle).toBeGreaterThan(0));
      const release = deps.api.hold("getMyCircle");
      void deps.queryClient.resetQueries({ queryKey: myCircleKey });
      deps.api.setMyPauseRequests(SINGLE);
      await deps.queryClient.refetchQueries({ queryKey: ["pauseRequests"] });
      expect(screen.queryByText("Los puntos se recalcularon")).not.toBeInTheDocument();
      expect(deps.device.get("pause-redistributed-seen:pause-1")).toBeNull();

      release();
      expect(await screen.findByText(/El de Andrea no cambia\.$/)).toBeInTheDocument();
      expect(deps.device.get("pause-redistributed-seen:pause-1")).toBe("1");
    });
  });
});
