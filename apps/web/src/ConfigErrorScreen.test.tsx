import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfigErrorScreen } from "./ConfigErrorScreen.tsx";
import { ConfigError } from "./config.ts";

describe("ConfigErrorScreen", () => {
  it("names every missing variable", () => {
    render(
      <ConfigErrorScreen error={new ConfigError(["VITE_API_BASE_URL", "VITE_SUPABASE_URL"], [])} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("VITE_API_BASE_URL");
    expect(screen.getByRole("alert")).toHaveTextContent("VITE_SUPABASE_URL");
  });

  it("names invalid variables too and points to .env.example", () => {
    render(<ConfigErrorScreen error={new ConfigError([], ["VITE_API_BASE_URL"])} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid: VITE_API_BASE_URL");
    expect(screen.getByRole("alert")).toHaveTextContent(".env.example");
  });
});
