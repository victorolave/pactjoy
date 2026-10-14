import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../ports/api-error.ts";
import { renderInProviders } from "../../../testing/render.tsx";
import { usePhotoUpload } from "./use-photo-upload.ts";

const FILE = new File(["raw"], "camera.heic", { type: "image/heic" });

function Probe() {
  const photo = usePhotoUpload("season-1", "commitment-1");
  return (
    <div>
      <output aria-label="state">{photo.state.status}</output>
      <output aria-label="cause">{photo.state.status === "failed" ? photo.state.cause : ""}</output>
      <output aria-label="id">{photo.state.status === "ready" ? photo.state.photoId : ""}</output>
      <button type="button" onClick={() => photo.pick(FILE)}>
        pick
      </button>
      <button type="button" onClick={photo.retry}>
        retry
      </button>
      <button type="button" onClick={photo.remove}>
        remove
      </button>
      <button type="button" onClick={photo.reject}>
        reject
      </button>
    </div>
  );
}

const state = () => screen.getByLabelText("state").textContent;
const click = (name: string) => userEvent.click(screen.getByRole("button", { name }));

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe("usePhotoUpload", () => {
  it("prepares, reserves for the prepared size, uploads the signed PUT and ends ready", async () => {
    const app = renderInProviders(<Probe />);

    await click("pick");

    await waitFor(() => expect(state()).toBe("ready"));
    expect(app.deps.imageProcessor.prepared).toEqual([FILE]);
    expect(app.deps.api.photoRequests).toEqual([
      { seasonId: "season-1", commitmentId: "commitment-1", byteSize: 4 },
    ]);
    expect(app.deps.photoUploader.puts).toHaveLength(1);
    expect(app.deps.photoUploader.puts[0]?.upload).toEqual({
      url: "https://storage.test/entry-photos/photo-1",
      headers: { "content-type": "image/jpeg" },
    });
    expect(screen.getByLabelText("id").textContent).toBe("photo-1");
  });

  it("shows preparing, then uploading, while each step runs", async () => {
    const app = renderInProviders(<Probe />);
    const releasePrepare = app.deps.imageProcessor.hold();
    const releaseUpload = app.deps.photoUploader.hold();

    await click("pick");
    expect(state()).toBe("preparing");
    await act(async () => releasePrepare());
    await waitFor(() => expect(state()).toBe("uploading"));
    await act(async () => releaseUpload());
    await waitFor(() => expect(state()).toBe("ready"));
  });

  it("an unusable image never reserves or uploads (SC-W4)", async () => {
    const app = renderInProviders(<Probe />);
    app.deps.imageProcessor.setResult({ ok: false, reason: "unreadable" });

    await click("pick");

    await waitFor(() => expect(state()).toBe("unusable"));
    expect(app.deps.api.photoRequests).toHaveLength(0);
    expect(app.deps.photoUploader.puts).toHaveLength(0);
  });

  it("a failed upload shows failed and Reintentar repeats it without a new pick (SC-W5)", async () => {
    const app = renderInProviders(<Probe />);
    app.deps.photoUploader.script("failed", "ok");

    await click("pick");
    await waitFor(() => expect(state()).toBe("failed"));
    expect(screen.getByLabelText("cause").textContent).toBe("retry");
    await click("retry");

    await waitFor(() => expect(state()).toBe("ready"));
    expect(app.deps.imageProcessor.prepared).toHaveLength(1);
    // A new slot each time: the first one may be spent.
    expect(app.deps.api.photoRequests).toHaveLength(2);
    expect(screen.getByLabelText("id").textContent).toBe("photo-2");
  });

  it("a rejected PUT (expired signature) is also a failure to retry", async () => {
    const app = renderInProviders(<Probe />);
    app.deps.photoUploader.script("rejected");

    await click("pick");

    await waitFor(() => expect(state()).toBe("failed"));
  });

  it("too many open slots is a failure whose cause is the limit", async () => {
    const app = renderInProviders(<Probe />);
    app.deps.api.failNext("requestPhotoUpload", new ApiError("TooManyPhotoUploads", 409, null));

    await click("pick");

    await waitFor(() => expect(state()).toBe("failed"));
    expect(screen.getByLabelText("cause").textContent).toBe("limit");
    expect(app.deps.photoUploader.puts).toHaveLength(0);
  });

  it("a network failure on the reservation is a failure to retry", async () => {
    const app = renderInProviders(<Probe />);
    app.deps.api.failNext("requestPhotoUpload", new ApiError("NetworkError", 0, null));

    await click("pick");

    await waitFor(() => expect(state()).toBe("failed"));
    expect(screen.getByLabelText("cause").textContent).toBe("retry");
  });

  it("reject (the server turned the photo down when saving) goes back to failed", async () => {
    renderInProviders(<Probe />);
    await click("pick");
    await waitFor(() => expect(state()).toBe("ready"));

    await click("reject");

    expect(state()).toBe("failed");
  });

  it("remove starts over and frees the preview", async () => {
    renderInProviders(<Probe />);
    await click("pick");
    await waitFor(() => expect(state()).toBe("ready"));

    await click("remove");

    expect(state()).toBe("idle");
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("an answer that arrives after remove is ignored", async () => {
    const app = renderInProviders(<Probe />);
    const releaseUpload = app.deps.photoUploader.hold();
    await click("pick");
    await waitFor(() => expect(state()).toBe("uploading"));

    await click("remove");
    await act(async () => releaseUpload());

    expect(state()).toBe("idle");
  });
});
