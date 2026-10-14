import { describe, expect, it, vi } from "vitest";
import type { RefreshResult } from "../ports/auth.ts";
import { HttpPactJoyApi } from "./http-pactjoy-api.ts";

const BASE = "http://api.test/api";

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const UPLOAD = {
  photoId: "11111111-1111-4111-8111-111111111111",
  upload: {
    method: "PUT",
    url: "https://storage.test/entry-photos/o/abc.jpg?X-Amz-Signature=s",
    headers: { "content-type": "image/jpeg" },
    expiresAt: "2026-10-13T12:05:00.000Z",
  },
  attachBy: "2026-10-13T12:30:00.000Z",
};

function harness(responses: Response[]) {
  const queue = [...responses];
  const fetchStub = vi.fn<typeof fetch>(async () => {
    const next = queue.shift();
    if (next === undefined) throw new Error("fetch called more often than scripted");
    return next;
  });
  const api = new HttpPactJoyApi({
    baseUrl: BASE,
    getAccessToken: async () => "t1",
    refreshAccessToken: async (): Promise<RefreshResult> => ({ status: "rejected" }),
    onUnauthorized: () => {},
    fetch: fetchStub,
  });
  return { api, fetchStub };
}

const bodyOf = (stub: ReturnType<typeof harness>["fetchStub"]) => {
  const init = stub.mock.calls[0]?.[1];
  return typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
};

describe("HttpPactJoyApi.requestPhotoUpload", () => {
  it("reserves a slot for the declared size and returns the signed request", async () => {
    const { api, fetchStub } = harness([json(201, { data: UPLOAD })]);

    await expect(
      api.requestPhotoUpload({ seasonId: "s 1", commitmentId: "c-1", byteSize: 4096 }),
    ).resolves.toEqual(UPLOAD);

    const [url, init] = fetchStub.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${BASE}/seasons/s%201/commitments/c-1/photos`);
    expect(init?.method).toBe("POST");
    expect(bodyOf(fetchStub)).toEqual({ byteSize: 4096, contentType: "image/jpeg" });
  });

  it("rejects a 2xx that is not a signed PUT with Internal", async () => {
    const { api } = harness([json(201, { data: { photoId: "p" } })]);

    await expect(
      api.requestPhotoUpload({ seasonId: "s-1", commitmentId: "c-1", byteSize: 10 }),
    ).rejects.toMatchObject({ code: "Internal", status: 201 });
  });

  it("surfaces the API error kind (TooManyPhotoUploads)", async () => {
    const { api } = harness([json(409, { error: { code: "TooManyPhotoUploads", message: "x" } })]);

    await expect(
      api.requestPhotoUpload({ seasonId: "s-1", commitmentId: "c-1", byteSize: 10 }),
    ).rejects.toMatchObject({ code: "TooManyPhotoUploads", status: 409 });
  });
});

describe("HttpPactJoyApi record and edit carry the photo", () => {
  it("sends photoId with a recorded entry", async () => {
    const { api, fetchStub } = harness([
      json(201, { data: { entry: { id: "e-1" }, replayed: false } }),
    ]);

    await api.recordEntry({
      seasonId: "s-1",
      commitmentId: "c-1",
      value: { kind: "quantity", value: "20" },
      note: null,
      photoId: UPLOAD.photoId,
      clientRequestId: "req-1",
    });

    expect(bodyOf(fetchStub).photoId).toBe(UPLOAD.photoId);
  });

  it("omits photoId from an edit that leaves the photo alone, sends null to remove it", async () => {
    const keep = harness([json(200, { data: { entry: { id: "e-1" } } })]);
    await keep.api.editEntry({ entryId: "e-1", value: { kind: "done" }, note: null });
    expect(bodyOf(keep.fetchStub)).toEqual({ value: { kind: "done" }, note: null });

    const remove = harness([json(200, { data: { entry: { id: "e-1" } } })]);
    await remove.api.editEntry({
      entryId: "e-1",
      value: { kind: "done" },
      note: null,
      photoId: null,
    });
    expect(bodyOf(remove.fetchStub)).toEqual({
      value: { kind: "done" },
      note: null,
      photoId: null,
    });
  });
});
