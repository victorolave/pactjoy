import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ClockProvider } from "../context/clock-context.tsx";
import { FixedClock } from "../testing/fixed-clock.ts";
import { EvidencePhoto } from "./EvidencePhoto.tsx";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const URL_OK = "https://storage.test/entry-photos/o/abc.jpg?X-Amz-Signature=s";

const withClock = (ui: ReactNode, clock = new FixedClock(NOW)) =>
  render(<ClockProvider clock={clock}>{ui}</ClockProvider>);

describe("EvidencePhoto", () => {
  it("shows the signed image with the approved alt text", () => {
    withClock(<EvidencePhoto url={URL_OK} expiresAt={NOW + 600_000} />);

    const image = screen.getByRole("img", { name: "Foto del registro" });
    expect(image.getAttribute("src")).toBe(URL_OK);
    expect(screen.queryByText("Foto no disponible")).toBeNull();
  });

  it("falls back to 'Foto no disponible' when the image fails to load, and says so once (SC-W6)", () => {
    const onUnavailable = vi.fn();
    withClock(
      <EvidencePhoto url={URL_OK} expiresAt={NOW + 600_000} onUnavailable={onUnavailable} />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Foto del registro" }));

    expect(screen.getByText("Foto no disponible")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("does not even request an expired URL: placeholder and one refetch", () => {
    const onUnavailable = vi.fn();
    withClock(<EvidencePhoto url={URL_OK} expiresAt={NOW - 1} onUnavailable={onUnavailable} />);

    expect(screen.getByText("Foto no disponible")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("a fresh URL after the refetch shows the image again", () => {
    const { rerender } = withClock(<EvidencePhoto url={URL_OK} expiresAt={NOW - 1} />);
    expect(screen.getByText("Foto no disponible")).toBeTruthy();

    rerender(
      <ClockProvider clock={new FixedClock(NOW)}>
        <EvidencePhoto url={`${URL_OK}2`} expiresAt={NOW + 600_000} />
      </ClockProvider>,
    );

    expect(screen.getByRole("img", { name: "Foto del registro" })).toBeTruthy();
  });
});
