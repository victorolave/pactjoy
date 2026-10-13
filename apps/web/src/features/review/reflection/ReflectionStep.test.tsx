import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { StepChrome } from "../chrome.ts";
import { ReflectionStep } from "./ReflectionStep.tsx";

const chrome: StepChrome = {
  onBack: () => {},
  backLabel: "Volver",
  backIcon: "chevron-left",
  progress: null,
};

const props = {
  chrome,
  helped: "",
  hard: "",
  errors: { helped: null, hard: null },
  onChange: () => {},
  onSkip: () => {},
  onNext: () => {},
};

describe("ReflectionStep (34)", () => {
  it("asks the two optional questions, only for the member, with the designed placeholders", () => {
    render(<ReflectionStep {...props} />);
    expect(screen.getByText("Opcional · solo para ti")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "¿Qué te ayudó?" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "¿Qué costó más?" })).toBeInTheDocument();
    expect(screen.getByLabelText("¿Qué te ayudó?")).toHaveAttribute(
      "placeholder",
      "Con tus palabras (opcional)",
    );
    expect(screen.getByLabelText("¿Qué costó más?")).toHaveAttribute(
      "placeholder",
      "Gym después del trabajo…",
    );
  });

  it("shows each question once, as the visible name of its field, under the designed picture", () => {
    render(<ReflectionStep {...props} />);
    expect(screen.getAllByText("¿Qué te ayudó?")).toHaveLength(1);
    expect(screen.getAllByText("¿Qué costó más?")).toHaveLength(1);
    const picture = screen.getByRole("img", {
      name: "Un hombre escribe en su cuaderno en la mesa",
    });
    expect(picture).toHaveAttribute("src", expect.stringContaining("reflexion"));
    const heading = screen.getByRole("heading", { level: 1 });
    expect(
      picture.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("reports what is typed in each field and caps it at the note limit", async () => {
    const onChange = vi.fn();
    render(<ReflectionStep {...props} onChange={onChange} />);
    expect(screen.getByLabelText("¿Qué te ayudó?")).toHaveAttribute("maxlength", "280");
    await userEvent.type(screen.getByLabelText("¿Qué costó más?"), "Gym");
    expect(onChange).toHaveBeenLastCalledWith("hard", "m");
    await userEvent.type(screen.getByLabelText("¿Qué te ayudó?"), "L");
    expect(onChange).toHaveBeenLastCalledWith("helped", "L");
  });

  it("skips only the reflection with 'Saltar' and continues with 'Continuar'", async () => {
    const onSkip = vi.fn();
    const onNext = vi.fn();
    render(<ReflectionStep {...props} onSkip={onSkip} onNext={onNext} />);
    await userEvent.click(screen.getByRole("button", { name: "Saltar" }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("shows the server's complaint under the field it named, and only there", () => {
    render(
      <ReflectionStep
        {...props}
        errors={{ helped: "Es demasiado largo. Acórtalo un poco.", hard: null }}
      />,
    );
    expect(screen.getByLabelText("¿Qué te ayudó?")).toBeInvalid();
    expect(screen.getByLabelText("¿Qué costó más?")).toBeValid();
    expect(screen.getByText("Es demasiado largo. Acórtalo un poco.")).toBeInTheDocument();
  });
});
