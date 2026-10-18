import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ClockProvider } from "../../../context/clock-context.tsx";
import { FixedClock } from "../../../testing/fixed-clock.ts";
import { PhotoField, type PhotoFieldProps } from "./PhotoField.tsx";
import type { PhotoUploadState } from "./photo-upload.ts";

const blob = new Blob(["jpeg"], { type: "image/jpeg" });
const READY: PhotoUploadState = {
  status: "ready",
  blob,
  previewUrl: "blob:preview",
  photoId: "p-1",
};

function field(overrides: Partial<PhotoFieldProps> = {}) {
  const props: PhotoFieldProps = {
    state: { status: "idle" },
    existing: null,
    online: true,
    missed: false,
    onPick: vi.fn(),
    onRetry: vi.fn(),
    onRemove: vi.fn(),
    ...overrides,
  };
  const view = render(
    <ClockProvider clock={new FixedClock(Date.now())}>
      <PhotoField {...props} />
    </ClockProvider>,
  );
  return { props, ...view };
}

const input = (container: HTMLElement) =>
  container.querySelector<HTMLInputElement>('input[type="file"]') as HTMLInputElement;

describe("PhotoField", () => {
  it("offers 'Añadir foto' and opens the library or the camera, never forcing capture (REQ-W1)", async () => {
    const { container, props } = field();
    const file = new File(["raw"], "a.heic", { type: "image/heic" });

    expect(screen.getByRole("button", { name: "Añadir foto" })).toBeEnabled();
    expect(input(container).hasAttribute("capture")).toBe(false);
    await userEvent.upload(input(container), file);

    expect(props.onPick).toHaveBeenCalledWith(file);
  });

  it("picking the same file twice in a row still picks (the input is reset)", async () => {
    const { container, props } = field();
    const file = new File(["raw"], "a.jpg", { type: "image/jpeg" });

    await userEvent.upload(input(container), file);
    await userEvent.upload(input(container), file);

    expect(props.onPick).toHaveBeenCalledTimes(2);
  });

  it("says 'Preparando foto…' and offers nothing else while it works", () => {
    field({ state: { status: "preparing" } });

    expect(screen.getByRole("status")).toHaveTextContent("Preparando foto…");
    expect(screen.queryByRole("button", { name: "Añadir foto" })).toBeNull();
  });

  it("says 'Subiendo foto…' next to the thumbnail while it uploads", () => {
    field({ state: { status: "uploading", blob, previewUrl: "blob:preview" } });

    expect(screen.getByRole("status")).toHaveTextContent("Subiendo foto…");
    expect(screen.getByRole("img", { name: "Foto del registro" })).toHaveAttribute(
      "src",
      "blob:preview",
    );
  });

  it("a ready photo shows the 96 px thumbnail, the 'Cambiar' tile and 'Quitar foto' (design 19)", async () => {
    const { container, props } = field({ state: READY });
    const file = new File(["raw"], "b.jpg", { type: "image/jpeg" });

    expect(screen.getByRole("img", { name: "Foto del registro" })).toHaveAttribute(
      "src",
      "blob:preview",
    );
    expect(screen.getByRole("button", { name: "Cambiar" })).toBeEnabled();
    await userEvent.upload(input(container), file);
    expect(props.onPick).toHaveBeenCalledWith(file);
    await userEvent.click(screen.getByRole("button", { name: "Quitar foto" }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it("a failed upload says so with Reintentar, and Reintentar does not ask for a new pick (SC-W5)", async () => {
    const { props } = field({
      state: { status: "failed", blob, previewUrl: "blob:preview", cause: "retry" },
    });

    await userEvent.click(
      screen.getByRole("button", { name: "No se pudo subir la foto · Reintentar" }),
    );

    expect(props.onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Quitar foto" })).toBeEnabled();
  });

  it("too many open uploads adds the reason to the failure", () => {
    field({ state: { status: "failed", blob, previewUrl: null, cause: "limit" } });

    expect(
      screen.getByText("Tienes demasiadas fotos pendientes. Inténtalo en unos minutos."),
    ).toBeTruthy();
  });

  it("an image that cannot be used says so and lets the member pick another (SC-W4)", () => {
    field({ state: { status: "unusable" } });

    expect(screen.getByRole("alert")).toHaveTextContent("Esta imagen no se puede usar");
    expect(screen.getByRole("button", { name: "Añadir foto" })).toBeEnabled();
  });

  it("the photo the entry already has shows with Cambiar and Quitar foto", async () => {
    const { props } = field({
      existing: { url: "https://storage.test/o/a.jpg?sig=1", expiresAt: Date.now() + 60_000 },
    });

    expect(screen.getByRole("img", { name: "Foto del registro" })).toHaveAttribute(
      "src",
      "https://storage.test/o/a.jpg?sig=1",
    );
    await userEvent.click(screen.getByRole("button", { name: "Quitar foto" }));
    expect(props.onRemove).toHaveBeenCalledTimes(1);
  });

  it("offline disables the control and says why (SC-W2)", () => {
    field({ online: false });

    expect(screen.getByRole("button", { name: "Añadir foto" })).toBeDisabled();
    expect(screen.getByText("La foto necesita conexión.")).toBeTruthy();
  });

  it("a missed entry disables the control and says why (SC-W3)", () => {
    field({ missed: true });

    expect(screen.getByRole("button", { name: "Añadir foto" })).toBeDisabled();
    expect(screen.getByText("Las fotos van con un registro hecho")).toBeTruthy();
  });

  it("offline also freezes Cambiar and Quitar foto", () => {
    field({ state: READY, online: false });

    expect(screen.getByRole("button", { name: "Cambiar" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Quitar foto" })).toBeDisabled();
  });

  it("no picked file, no call", () => {
    const { container, props } = field();

    fireEvent.change(input(container), { target: { files: [] } });

    expect(props.onPick).not.toHaveBeenCalled();
  });
});
