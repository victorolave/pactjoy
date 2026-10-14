import { describe, expect, it } from "vitest";
import { mintObjectKey } from "../entry-photo/object-key.ts";
import type { EvidenceStorage, SignedRequest } from "../ports/evidence-storage.ts";
import { createSeededRandomSource } from "../testing/seeded-random.ts";
import { type Instant, instant } from "../time/instant.ts";

/**
 * What the contract needs from an adapter. `upload` and `download` execute a SIGNED request the way
 * a browser would (the S3 adapter's subject does a real `fetch`; the fake's calls its own helpers),
 * so the suite proves the signatures, not just the bookkeeping.
 */
export interface EvidenceStorageContractSubject {
  readonly storage: EvidenceStorage;
  /** The instant the storage judges expiry against: the fake's clock, or the wall clock. */
  readonly now: () => Instant;
  /** Sends `bytes` to a signed PUT. `headers` replaces the signed ones (to test a wrong type). */
  upload(
    request: SignedRequest,
    bytes: Uint8Array,
    headers?: Readonly<Record<string, string>>,
  ): Promise<"accepted" | "rejected">;
  /** Executes a signed GET; `null` when the object cannot be fetched. */
  download(request: SignedRequest): Promise<Uint8Array | null>;
}

const JPEG = (length: number): Uint8Array => {
  const bytes = new Uint8Array(length);
  bytes.set([0xff, 0xd8, 0xff], 0);
  for (let i = 3; i < length; i++) bytes[i] = (i * 31) % 251;
  return bytes;
};

const TTL = 300;

/**
 * `EvidenceStorage` contract, adapter-neutral. The factory may return a shared store: every test
 * mints its own key, so nothing depends on the store being empty.
 */
export function describeEvidenceStorageContract(
  name: string,
  factory: () => Promise<EvidenceStorageContractSubject>,
): void {
  describe(`EvidenceStorage contract (${name})`, () => {
    const random = createSeededRandomSource(0x5eed);
    const freshKey = () => mintObjectKey(random);

    const put = async (subject: EvidenceStorageContractSubject, key: string, bytes: Uint8Array) => {
      const signed = await subject.storage.signUpload(
        key,
        { size: bytes.length, contentType: "image/jpeg" },
        TTL,
        subject.now(),
      );
      return subject.upload(signed, bytes);
    };

    it("signUpload returns a PUT that pins the content type and expires after the TTL", async () => {
      const subject = await factory();
      const now = subject.now();
      const signed = await subject.storage.signUpload(
        freshKey(),
        { size: 10, contentType: "image/jpeg" },
        TTL,
        now,
      );
      expect(signed.method).toBe("PUT");
      expect(signed.headers["content-type"]).toBe("image/jpeg");
      expect(signed.expiresAt).toBe(instant(now + TTL * 1000));
    });

    it("an upload of exactly the declared size is accepted and stat reports it", async () => {
      const subject = await factory();
      const key = freshKey();
      expect(await put(subject, key, JPEG(1234))).toBe("accepted");
      expect(await subject.storage.stat(key)).toEqual({ size: 1234, contentType: "image/jpeg" });
    });

    it("an upload of a different size is rejected and nothing is stored", async () => {
      const subject = await factory();
      const key = freshKey();
      const signed = await subject.storage.signUpload(
        key,
        { size: 1000, contentType: "image/jpeg" },
        TTL,
        subject.now(),
      );
      expect(await subject.upload(signed, JPEG(1001))).toBe("rejected");
      expect(await subject.upload(signed, JPEG(999))).toBe("rejected");
      expect(await subject.storage.stat(key)).toBeNull();
    });

    it("an upload with a different content type is rejected", async () => {
      const subject = await factory();
      const key = freshKey();
      const signed = await subject.storage.signUpload(
        key,
        { size: 50, contentType: "image/jpeg" },
        TTL,
        subject.now(),
      );
      expect(await subject.upload(signed, JPEG(50), { "content-type": "image/png" })).toBe(
        "rejected",
      );
      expect(await subject.storage.stat(key)).toBeNull();
    });

    it("an expired upload URL is rejected", async () => {
      const subject = await factory();
      const key = freshKey();
      const signed = await subject.storage.signUpload(
        key,
        { size: 50, contentType: "image/jpeg" },
        60,
        instant(subject.now() - 3_600_000),
      );
      expect(await subject.upload(signed, JPEG(50))).toBe("rejected");
      expect(await subject.storage.stat(key)).toBeNull();
    });

    it("stat and readHead of a missing object are null", async () => {
      const subject = await factory();
      const key = freshKey();
      expect(await subject.storage.stat(key)).toBeNull();
      expect(await subject.storage.readHead(key, 3)).toBeNull();
    });

    it("readHead returns the first bytes, or the whole object when it is shorter", async () => {
      const subject = await factory();
      const key = freshKey();
      const bytes = JPEG(10);
      await put(subject, key, bytes);
      expect(await subject.storage.readHead(key, 3)).toEqual(bytes.slice(0, 3));
      expect(await subject.storage.readHead(key, 100)).toEqual(bytes);
    });

    it("signDownloads gives one GET per key and the bytes come back identical", async () => {
      const subject = await factory();
      const [a, b] = [freshKey(), freshKey()];
      const [bytesA, bytesB] = [JPEG(64), JPEG(65)];
      await put(subject, a, bytesA);
      await put(subject, b, bytesB);
      const now = subject.now();
      const urls = await subject.storage.signDownloads([a, b], 600, now);
      expect([...urls.keys()].sort()).toEqual([a, b].sort());
      const first = urls.get(a);
      const second = urls.get(b);
      expect(first?.method).toBe("GET");
      expect(first?.expiresAt).toBe(instant(now + 600_000));
      expect(first && (await subject.download(first))).toEqual(bytesA);
      expect(second && (await subject.download(second))).toEqual(bytesB);
    });

    it("signDownloads of no keys is empty", async () => {
      const subject = await factory();
      expect((await subject.storage.signDownloads([], 600, subject.now())).size).toBe(0);
    });

    it("delete removes the object and is idempotent", async () => {
      const subject = await factory();
      const key = freshKey();
      await put(subject, key, JPEG(20));
      await subject.storage.delete(key);
      expect(await subject.storage.stat(key)).toBeNull();
      await expect(subject.storage.delete(key)).resolves.toBeUndefined();
      await expect(subject.storage.delete(freshKey())).resolves.toBeUndefined();
    });
  });
}
