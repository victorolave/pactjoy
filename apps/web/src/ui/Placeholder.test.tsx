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

describe("Illustration with an official image", () => {
  it.each(["registro-guardado", "sin-conexion", "cocinar"] as const)(
    "shows the %s illustration by name",
    (name) => {
      const { container } = render(<Illustration alt="Imagen" name={name} />);
      expect(container.querySelector("img")).toHaveAttribute("src", expect.stringContaining(name));
      expect(screen.getByRole("img", { name: "Imagen" })).toBeInTheDocument();
    },
  );

  it("lets an explicit src win over a name", () => {
    const { container } = render(<Illustration alt="Imagen" name="cocinar" src="/otra.png" />);
    expect(container.querySelector("img")).toHaveAttribute("src", "/otra.png");
  });

  it("draws a contained square of the asked size instead of the full width (design 20: 200)", () => {
    const { container } = render(<Illustration alt="Imagen" name="registro-guardado" size="lg" />);
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("data-size", "lg");
    expect(image?.className).toMatch(/imageSized/);
  });

  it("has no size on an image that fills its width", () => {
    const { container } = render(<Illustration alt="Imagen" name="cocinar" />);
    expect(container.querySelector("img")).not.toHaveAttribute("data-size");
  });

  it("still draws the neutral placeholder with neither a name nor a src", () => {
    const { container } = render(<Illustration alt="Imagen" />);
    expect(container.querySelector("img")).toBeNull();
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
