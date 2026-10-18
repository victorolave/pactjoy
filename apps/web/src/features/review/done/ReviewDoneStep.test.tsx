import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ReviewDoneStep } from "./ReviewDoneStep.tsx";

const names = new Map([
  ["l", "Leer"],
  ["d", "Dibujar"],
]);

describe("ReviewDoneStep (35b)", () => {
  it("confirms the save and lists each improved habit with its range", () => {
    render(
      <ReviewDoneStep
        result={{
          improvements: [
            { commitmentId: "l", from: "3,5", to: "4,5" },
            { commitmentId: "d", from: "3", to: "4" },
          ],
          nextReviewDate: "2026-10-20",
        }}
        names={names}
        onFinish={() => {}}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Revisión guardada." }),
    ).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Se sienten más automáticos que al empezar" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(within(rows[0] as HTMLElement).getByText("Leer")).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText("3,5 → 4,5")).toBeInTheDocument();
    expect(
      within(rows[0] as HTMLElement).getByRole("img", { name: "Leer: de 3,5 a 4,5" }),
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByRole("img", { name: "Dibujar: de 3 a 4" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Próxima revisión: mar 20 oct")).toBeInTheDocument();
  });

  it("opens with the designed picture, before the heading", () => {
    render(<ReviewDoneStep result={null} names={names} onFinish={() => {}} />);
    const picture = screen.getByRole("img", {
      name: "Una persona estudia con auriculares y toma notas",
    });
    expect(picture).toHaveAttribute("src", expect.stringContaining("revision-estudiar"));
    const heading = screen.getByRole("heading", { level: 1 });
    expect(
      picture.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows only the next review chip when nothing improved", () => {
    render(
      <ReviewDoneStep
        result={{ improvements: [], nextReviewDate: "2026-10-20" }}
        names={names}
        onFinish={() => {}}
      />,
    );
    expect(screen.getByText("Próxima revisión: mar 20 oct")).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByText(/automáticos/)).not.toBeInTheDocument();
  });

  it("has no chip without a next review date", () => {
    render(
      <ReviewDoneStep
        result={{
          improvements: [{ commitmentId: "l", from: "3", to: "4" }],
          nextReviewDate: null,
        }}
        names={names}
        onFinish={() => {}}
      />,
    );
    expect(screen.queryByText(/Próxima revisión/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("keeps the closing review's wording: the results date and no list or chip", () => {
    render(
      <ReviewDoneStep
        result={{ improvements: [], nextReviewDate: null }}
        names={names}
        closing
        resultsOpenOn="2026-10-06"
        onFinish={() => {}}
      />,
    );
    expect(
      screen.getByText("Tus resultados estarán listos el martes 6 de octubre."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seguir con mi día" })).toBeInTheDocument();
    expect(screen.queryByText(/Próxima revisión/)).not.toBeInTheDocument();
  });

  it("is still a saved review when the details are unknown (it was already saved)", () => {
    render(<ReviewDoneStep result={null} names={names} onFinish={() => {}} />);
    expect(screen.getByRole("heading", { name: "Revisión guardada." })).toBeInTheDocument();
  });

  it("places the encouragement nudge it is given between the content and the way on", () => {
    render(
      <ReviewDoneStep
        result={null}
        names={names}
        nudge={<p>Sugerencia de ánimo</p>}
        onFinish={() => {}}
      />,
    );
    expect(screen.getByText("Sugerencia de ánimo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Seguir con mi día" })).toBeInTheDocument();
  });

  it("shows no nudge area when it is given none", () => {
    render(<ReviewDoneStep result={null} names={names} onFinish={() => {}} />);
    expect(screen.queryByText("Sugerencia de ánimo")).not.toBeInTheDocument();
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

  it("leads to the results after the closing review", async () => {
    const onFinish = vi.fn();
    render(<ReviewDoneStep result={null} names={names} closing onFinish={onFinish} />);
    expect(screen.queryByRole("button", { name: "Seguir con mi día" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver mis resultados" }));
    expect(onFinish).toHaveBeenCalledOnce();
  });
});
