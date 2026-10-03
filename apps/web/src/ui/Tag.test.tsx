import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Tag } from "./Tag.tsx";

describe("Tag", () => {
  it("is plain text when it has neither a selection nor a handler", () => {
    render(<Tag>Privado</Tag>);
    expect(screen.getByText("Privado")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("is a toggle button with aria-pressed when given a selected state", async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <Tag selected={false} onClick={onClick}>
        Semana
      </Tag>,
    );
    const tag = screen.getByRole("button", { name: "Semana" });
    expect(tag).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(tag);
    expect(onClick).toHaveBeenCalledTimes(1);
    rerender(
      <Tag selected onClick={onClick}>
        Semana
      </Tag>,
    );
    expect(screen.getByRole("button", { name: "Semana" })).toHaveAttribute("aria-pressed", "true");
  });

  it("is a plain button, without aria-pressed, when only clickable", () => {
    render(<Tag onClick={() => {}}>Ver más</Tag>);
    expect(screen.getByRole("button", { name: "Ver más" })).not.toHaveAttribute("aria-pressed");
  });
});
