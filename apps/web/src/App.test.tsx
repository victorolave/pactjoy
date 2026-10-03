import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.tsx";

describe("App", () => {
  it("renders the application root", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "PactJoy" })).toBeInTheDocument();
  });

  it("renders inside a main landmark", () => {
    render(<App />);
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
