import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReviewDoneStep } from "./ReviewDoneStep.tsx";

const names = new Map([
  ["l", "Leer"],
  ["d", "Dibujar"],
]);

describe("ReviewDoneStep (35b)", () => {
  it("confirms the save, names only the improvements and gives the next date", () => {
    render(
      <ReviewDoneStep
        result={{
          improvements: [
            { commitmentId: "l", from: "3,5", to: "4,5" },
            { commitmentId: "d", from: "3", to: "4" },
          ],
          nextReviewDate: "2026-10-06",
        }}
        names={names}
        onFinish={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Revisión guardada." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Leer y Dibujar se sienten más automáticos que al empezar (de 3,5 a 4,5 y de 3 a 4). La próxima revisión es el martes 6 de octubre.",
      ),
    ).toBeInTheDocument();
  });

  it("says only when the next review is when nothing improved", () => {
    render(
      <ReviewDoneStep
        result={{ improvements: [], nextReviewDate: "2026-10-06" }}
        names={names}
        onFinish={() => {}}
      />,
    );
    expect(screen.getByText("La próxima revisión es el martes 6 de octubre.")).toBeInTheDocument();
    expect(screen.queryByText(/automáticos/)).not.toBeInTheDocument();
  });

  it("is still a saved review when the details are unknown (it was already saved)", () => {
    render(<ReviewDoneStep result={null} names={names} onFinish={() => {}} />);
    expect(screen.getByRole("heading", { name: "Revisión guardada." })).toBeInTheDocument();
  });

  it("goes back to the day with 'Seguir con mi día'", async () => {
    const onFinish = vi.fn();
    render(
      <ReviewDoneStep
        result={{ improvements: [], nextReviewDate: null }}
        names={names}
        onFinish={onFinish}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Seguir con mi día" }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });
});
