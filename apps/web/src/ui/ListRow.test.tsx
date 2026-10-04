import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ListRow } from "./ListRow.tsx";

describe("ListRow", () => {
  it("shows a label and its value as plain text when it has no action", () => {
    render(<ListRow label="Correo" value="andrea@example.com" />);
    expect(screen.getByText("Correo")).toBeInTheDocument();
    expect(screen.getByText("andrea@example.com")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is a button when it has an action, and runs it on tap", async () => {
    const onClick = vi.fn();
    render(<ListRow label="Cerrar sesión" onClick={onClick} />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not run the action while disabled", async () => {
    const onClick = vi.fn();
    render(<ListRow label="Cerrar sesión" onClick={onClick} disabled />);
    await userEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
