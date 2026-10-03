import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { NoteField } from "./NoteField.tsx";

function Controlled({ initial = "", error }: { initial?: string; error?: string }) {
  const [note, setNote] = useState(initial);
  return <NoteField value={note} onChange={setNote} {...(error === undefined ? {} : { error })} />;
}

describe("NoteField", () => {
  it("starts collapsed behind a button", () => {
    render(<Controlled />);
    expect(screen.getByRole("button", { name: "Añadir nota" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("opens a labelled text area, and the text is kept", async () => {
    render(<Controlled />);
    await userEvent.click(screen.getByRole("button", { name: "Añadir nota" }));
    const area = screen.getByRole("textbox", { name: "Nota (opcional)" });
    await userEvent.type(area, "Terminé el capítulo 12.");
    expect(area).toHaveValue("Terminé el capítulo 12.");
  });

  it("removing the note clears the text and collapses", async () => {
    render(<Controlled initial="algo" />);
    expect(screen.getByRole("textbox", { name: "Nota (opcional)" })).toHaveValue("algo");
    await userEvent.click(screen.getByRole("button", { name: "Quitar nota" }));
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Añadir nota" }));
    expect(screen.getByRole("textbox", { name: "Nota (opcional)" })).toHaveValue("");
  });

  it("starts open when it already has text (editing an entry)", () => {
    render(<Controlled initial="ya había" />);
    expect(screen.getByRole("textbox", { name: "Nota (opcional)" })).toHaveValue("ya había");
  });

  it("shows an error tied to the text area and keeps it open", () => {
    render(<Controlled error="La nota es demasiado larga." />);
    const area = screen.getByRole("textbox", { name: "Nota (opcional)" });
    expect(area).toHaveAccessibleDescription("La nota es demasiado larga.");
    expect(area).toHaveAttribute("aria-invalid", "true");
  });
});
