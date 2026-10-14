import { describe, expect, it, vi } from "vitest";
import { FetchPhotoUploader } from "./fetch-photo-uploader.ts";

const SIGNED = {
  url: "https://storage.test/entry-photos/o/abc.jpg?X-Amz-Signature=s",
  headers: { "content-type": "image/jpeg" },
};
const BLOB = new Blob(["jpeg"], { type: "image/jpeg" });

function uploader(respond: () => Promise<Response>) {
  const fetchStub = vi.fn<typeof fetch>(async () => respond());
  return { uploader: new FetchPhotoUploader(fetchStub), fetchStub };
}

describe("FetchPhotoUploader.put", () => {
  it("PUTs the bytes to the signed URL with the signed headers and nothing else", async () => {
    const { uploader: sut, fetchStub } = uploader(async () => new Response(null, { status: 200 }));

    await expect(sut.put(SIGNED, BLOB)).resolves.toBe("ok");

    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(url).toBe(SIGNED.url);
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(BLOB);
    expect(Object.fromEntries(new Headers(init?.headers))).toEqual({
      "content-type": "image/jpeg",
    });
    expect(init?.credentials).toBe("omit");
  });

  it("never sends Authorization, even if one slipped into the headers", async () => {
    const { uploader: sut, fetchStub } = uploader(async () => new Response(null, { status: 200 }));

    await sut.put(
      { ...SIGNED, headers: { ...SIGNED.headers, Authorization: "Bearer secret", Cookie: "a=b" } },
      BLOB,
    );

    const headers = new Headers(fetchStub.mock.calls[0]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
  });

  it.each([400, 403, 413, 415])("a %i means the slot is spent: rejected", async (status) => {
    const { uploader: sut } = uploader(async () => new Response(null, { status }));

    await expect(sut.put(SIGNED, BLOB)).resolves.toBe("rejected");
  });

  it("a 5xx or a network failure may work next time: failed", async () => {
    const down = uploader(async () => new Response(null, { status: 503 }));
    const offline = uploader(async () => {
      throw new TypeError("Failed to fetch");
    });

    await expect(down.uploader.put(SIGNED, BLOB)).resolves.toBe("failed");
    await expect(offline.uploader.put(SIGNED, BLOB)).resolves.toBe("failed");
  });

  it("passes the abort signal along", async () => {
    const { uploader: sut, fetchStub } = uploader(async () => new Response(null, { status: 200 }));
    const controller = new AbortController();

    await sut.put(SIGNED, BLOB, controller.signal);

    expect(fetchStub.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});
