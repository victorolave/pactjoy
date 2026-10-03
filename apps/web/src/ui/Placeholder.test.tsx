import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Illustration, Logo } from "./Placeholder.tsx";

describe("Illustration (WF-R5, WF-S4)", () => {
  it("renders a neutral placeholder, and requests no image, when there is no src", () => {
    const { container } = render(<Illustration alt="Sin círculo todavía" />);
    expect(screen.getByRole("img", { name: "Sin círculo todavía" })).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the image when a src is provided", () => {
    const { container } = render(<Illustration alt="Círculo" src="/assets/circle.svg" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/assets/circle.svg");
    expect(screen.getByRole("img", { name: "Círculo" })).toBeInTheDocument();
  });
});

describe("Logo (official brand files)", () => {
  it("is the official horizontal logo by default, named PactJoy, never live text", () => {
    const { container } = render(<Logo />);
    expect(screen.getByRole("img", { name: "PactJoy" })).toHaveAttribute(
      "src",
      expect.stringContaining("pactjoy-horizontal-proposed"),
    );
    expect(container).not.toHaveTextContent("PactJoy");
  });

  it("can be the symbol alone, a different file from the horizontal logo", () => {
    const { unmount } = render(<Logo />);
    const horizontal = screen.getByRole("img", { name: "PactJoy" }).getAttribute("src");
    unmount();
    render(<Logo variant="symbol" />);
    const symbol = screen.getByRole("img", { name: "PactJoy" }).getAttribute("src");
    expect(symbol).toBeTruthy();
    expect(symbol).not.toBe(horizontal);
  });

  it("renders another logo file when a src is provided", () => {
    const { container } = render(<Logo src="/assets/logo.svg" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/assets/logo.svg");
  });
});
