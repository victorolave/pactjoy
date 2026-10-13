import { EvidenceStorageError, instant } from "@pactjoy/app";
import { describe, expect, it, vi } from "vitest";
import { createS3EvidenceStorage } from "./s3-evidence-storage.ts";
import { presign } from "./sigv4.ts";

const KEY = "o/0123456789abcdef0123456789abcdef.jpg";
const SECRET = "secretKeyThatMustNeverLeak0123456789";
const NOW = instant(1_791_892_800_000);

type FetchFn = typeof fetch;

function setup(
  respond: (url: string, init: RequestInit) => Response | Promise<Response> = () =>
    new Response(null, { status: 200 }),
  extra: {
    publicEndpoint?: string;
    endpoint?: string;
    signingHost?: string;
    publicSigningHost?: string;
  } = {},
) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call.url, call.init);
  });
  const storage = createS3EvidenceStorage({
    endpoint: extra.endpoint ?? "http://kong:8000/storage/v1/s3",
    ...(extra.publicEndpoint ? { publicEndpoint: extra.publicEndpoint } : {}),
    ...(extra.signingHost ? { signingHost: extra.signingHost } : {}),
    ...(extra.publicSigningHost ? { publicSigningHost: extra.publicSigningHost } : {}),
    region: "local",
    bucket: "entry-photos",
    accessKeyId: "AKIDEXAMPLE",
    secretAccessKey: SECRET,
    fetch: fetchMock as unknown as FetchFn,
    now: () => NOW,
  });
  return { storage, calls, fetchMock };
}

describe("signUpload", () => {
  it("signs a path-style PUT for the PUBLIC endpoint, pinning length and type", async () => {
    const { storage, fetchMock } = setup(undefined, {
      publicEndpoint: "https://tunnel.example/storage/v1/s3",
    });
    const signed = await storage.signUpload(
      KEY,
      { size: 1234, contentType: "image/jpeg" },
      300,
      NOW,
    );
    expect(signed.method).toBe("PUT");
    expect(signed.url.startsWith(`https://tunnel.example/storage/v1/s3/entry-photos/${KEY}?`)).toBe(
      true,
    );
    expect(signed.url).toContain("X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost");
    expect(signed.url).toContain("X-Amz-Expires=300");
    expect(signed.headers).toEqual({ "content-type": "image/jpeg" });
    expect(signed.expiresAt).toBe(instant(NOW + 300_000));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the endpoint when there is no public endpoint", async () => {
    const { storage } = setup();
    const signed = await storage.signUpload(KEY, { size: 1, contentType: "image/jpeg" }, 60, NOW);
    expect(signed.url.startsWith("http://kong:8000/storage/v1/s3/entry-photos/")).toBe(true);
  });

  it("tolerates a trailing slash on the endpoint", async () => {
    const { storage } = setup(undefined, { endpoint: "http://kong:8000/storage/v1/s3/" });
    const signed = await storage.signUpload(KEY, { size: 1, contentType: "image/jpeg" }, 60, NOW);
    expect(signed.url.startsWith("http://kong:8000/storage/v1/s3/entry-photos/o/")).toBe(true);
  });
});

const signatureOf = (url: string) => new URL(url).searchParams.get("X-Amz-Signature");

describe("signing host override (Kong validates <X-Forwarded-Host>:54321)", () => {
  const reference = async (host: string, method: string, path: string, expiresSeconds = 60) =>
    signatureOf(
      await presign({
        method,
        url: `http://${host}${path}`,
        region: "local",
        credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: SECRET },
        now: NOW,
        expiresSeconds,
      }),
    );

  it("server calls connect to the endpoint but sign for `signingHost`", async () => {
    const { storage, calls } = setup(
      () => new Response(null, { status: 200, headers: { "content-length": "1" } }),
      { signingHost: "kong:54321" },
    );
    await storage.stat(KEY);
    const url = calls[0]?.url ?? "";
    expect(url.startsWith(`http://kong:8000/storage/v1/s3/entry-photos/${KEY}?`)).toBe(true);
    expect(signatureOf(url)).toBe(
      await reference("kong:54321", "HEAD", `/storage/v1/s3/entry-photos/${KEY}`),
    );
  });

  it("browser URLs keep the public endpoint and sign for `publicSigningHost`", async () => {
    const { storage } = setup(undefined, {
      publicEndpoint: "https://tunnel.example/storage/v1/s3",
      publicSigningHost: "tunnel.example:54321",
    });
    const downloads = await storage.signDownloads([KEY], 600, NOW);
    const url = downloads.get(KEY)?.url ?? "";
    expect(url.startsWith(`https://tunnel.example/storage/v1/s3/entry-photos/${KEY}?`)).toBe(true);
    expect(signatureOf(url)).toBe(
      await reference("tunnel.example:54321", "GET", `/storage/v1/s3/entry-photos/${KEY}`, 600),
    );
    const upload = await storage.signUpload(KEY, { size: 5, contentType: "image/jpeg" }, 300, NOW);
    expect(upload.url.startsWith("https://tunnel.example/")).toBe(true);
    expect(upload.url).not.toContain("tunnel.example:54321");
  });

  it("the two overrides are independent", async () => {
    const { storage, calls } = setup(
      () => new Response(null, { status: 200, headers: { "content-length": "1" } }),
      { publicEndpoint: "https://tunnel.example/s3", publicSigningHost: "tunnel.example:54321" },
    );
    await storage.stat(KEY);
    // server side has no override: signed for the host it connects to
    expect(signatureOf(calls[0]?.url ?? "")).toBe(
      await reference("kong:8000", "HEAD", `/storage/v1/s3/entry-photos/${KEY}`),
    );
  });
});

describe("signDownloads", () => {
  it("signs one GET per key for the public endpoint without touching the network", async () => {
    const { storage, fetchMock } = setup(undefined, {
      publicEndpoint: "http://127.0.0.1:54321/s3",
    });
    const other = "o/ffffffffffffffffffffffffffffffff.jpg";
    const urls = await storage.signDownloads([KEY, other], 600, NOW);
    expect([...urls.keys()]).toEqual([KEY, other]);
    const first = urls.get(KEY);
    expect(first?.method).toBe("GET");
    expect(first?.headers).toEqual({});
    expect(first?.url.startsWith(`http://127.0.0.1:54321/s3/entry-photos/${KEY}?`)).toBe(true);
    expect(first?.url).toContain("X-Amz-SignedHeaders=host&");
    expect(first?.expiresAt).toBe(instant(NOW + 600_000));
    expect(urls.get(other)?.url).not.toBe(first?.url);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("stat", () => {
  it("sends a presigned HEAD to the server endpoint and reads size and type", async () => {
    const { storage, calls } = setup(
      () =>
        new Response(null, {
          status: 200,
          headers: { "content-length": "1234", "content-type": "image/jpeg" },
        }),
      { publicEndpoint: "https://tunnel.example/s3" },
    );
    await expect(storage.stat(KEY)).resolves.toEqual({ size: 1234, contentType: "image/jpeg" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("HEAD");
    expect(calls[0]?.url.startsWith(`http://kong:8000/storage/v1/s3/entry-photos/${KEY}?`)).toBe(
      true,
    );
    expect(calls[0]?.url).toContain("X-Amz-Signature=");
  });

  it("maps 404 to null", async () => {
    const { storage } = setup(() => new Response(null, { status: 404 }));
    await expect(storage.stat(KEY)).resolves.toBeNull();
  });

  it("refuses a response without a usable content-length", async () => {
    const { storage } = setup(() => new Response(null, { status: 200 }));
    await expect(storage.stat(KEY)).rejects.toMatchObject({ code: "rejected" });
  });
});

describe("readHead", () => {
  it("sends a ranged presigned GET and returns the bytes of a 206", async () => {
    const { storage, calls } = setup(
      () => new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 206 }),
    );
    await expect(storage.readHead(KEY, 3)).resolves.toEqual(new Uint8Array([0xff, 0xd8, 0xff]));
    expect(calls[0]?.init.method).toBe("GET");
    expect(new Headers(calls[0]?.init.headers).get("range")).toBe("bytes=0-2");
  });

  it("keeps only the first bytes when the server ignored the range (200)", async () => {
    const { storage } = setup(() => new Response(new Uint8Array([1, 2, 3, 4, 5]), { status: 200 }));
    await expect(storage.readHead(KEY, 3)).resolves.toEqual(new Uint8Array([1, 2, 3]));
  });

  it.each([404, 416])("maps %i to null", async (status) => {
    const { storage } = setup(() => new Response(null, { status }));
    await expect(storage.readHead(KEY, 3)).resolves.toBeNull();
  });

  it("rejects a non-positive byte count", async () => {
    const { storage } = setup();
    await expect(storage.readHead(KEY, 0)).rejects.toThrow(RangeError);
  });
});

describe("delete", () => {
  it.each([200, 204, 404])("treats %i as deleted", async (status) => {
    const { storage, calls } = setup(() => new Response(null, { status }));
    await expect(storage.delete(KEY)).resolves.toBeUndefined();
    expect(calls[0]?.init.method).toBe("DELETE");
  });
});

describe("error mapping", () => {
  const cases: Array<[string, Response | Error, string]> = [
    ["401", new Response(null, { status: 401 }), "unauthorized"],
    ["403", new Response(null, { status: 403 }), "unauthorized"],
    ["400", new Response(null, { status: 400 }), "rejected"],
    ["409", new Response(null, { status: 409 }), "rejected"],
    ["500", new Response(null, { status: 500 }), "unavailable"],
    ["503", new Response(null, { status: 503 }), "unavailable"],
    [
      "network failure",
      new Error(`fetch failed http://kong:8000/${KEY}?X-Amz-Signature=abc`),
      "unavailable",
    ],
  ];

  it.each(cases)(
    "%s on every server call becomes a leak-free EvidenceStorageError",
    async (_n, outcome, code) => {
      const respond = () => {
        if (outcome instanceof Error) throw outcome;
        return outcome.clone();
      };
      const calls = [
        (s: ReturnType<typeof setup>["storage"]) => s.stat(KEY),
        (s: ReturnType<typeof setup>["storage"]) => s.readHead(KEY, 3),
        (s: ReturnType<typeof setup>["storage"]) => s.delete(KEY),
      ];
      for (const call of calls) {
        const { storage } = setup(respond);
        const error = await call(storage).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(EvidenceStorageError);
        expect((error as EvidenceStorageError).code).toBe(code);
        const everything = JSON.stringify(error, Object.getOwnPropertyNames(error as object));
        for (const secret of [KEY, "entry-photos", "kong", "X-Amz", SECRET, "AKIDEXAMPLE"]) {
          expect(everything).not.toContain(secret);
        }
        expect((error as Error).cause).toBeUndefined();
      }
    },
  );
});
