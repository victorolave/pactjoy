import { describe, expect, it } from "vitest";
import { deriveSigningKey, presign, toHex } from "./sigv4.ts";

/**
 * Vectors are copied verbatim from the AWS documentation. The signing-key example is in
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
 * ("Examples of how to derive a signing key for Signature Version 4"), the S3 query-string
 * example in https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html.
 */
describe("deriveSigningKey (AWS documentation example)", () => {
  it("derives the documented signing key for 20120215 / us-east-1 / iam", async () => {
    const key = await deriveSigningKey(
      "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      "20120215",
      "us-east-1",
      "iam",
    );
    expect(toHex(key)).toBe("f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d");
  });
});

describe("presign", () => {
  const credentials = {
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  };

  it("reproduces the S3 documentation presigned GET (examplebucket/test.txt, 86400 s)", async () => {
    const url = await presign({
      method: "GET",
      url: "https://examplebucket.s3.amazonaws.com/test.txt",
      region: "us-east-1",
      credentials,
      now: 1_369_353_600_000, // 20130524T000000Z
      expiresSeconds: 86_400,
    });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20130524T000000Z" +
        "&X-Amz-Expires=86400" +
        "&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  // Golden value computed with an independent implementation (Python hmac/hashlib) from the same
  // canonical request, so it does not just echo this module back at itself. The real servers
  // (SeaweedFS in test/, Supabase in scripts/smoke-supabase.ts) accept the same construction.
  it("signs content-length and content-type for a path-style PUT with a port in the host", async () => {
    const url = await presign({
      method: "PUT",
      url: "http://127.0.0.1:54321/storage/v1/s3/entry-photos/o/0123456789abcdef0123456789abcdef.jpg",
      region: "local",
      credentials: {
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "exampleSecretKeyForGoldenTestOnly0000000000",
      },
      now: 1_791_892_800_000, // 20261013T120000Z
      expiresSeconds: 300,
      headers: { "content-type": "image/jpeg", "content-length": "1234" },
    });
    expect(url).toBe(
      "http://127.0.0.1:54321/storage/v1/s3/entry-photos/o/0123456789abcdef0123456789abcdef.jpg" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        "&X-Amz-Credential=AKIDEXAMPLE%2F20261013%2Flocal%2Fs3%2Faws4_request" +
        "&X-Amz-Date=20261013T120000Z" +
        "&X-Amz-Expires=300" +
        "&X-Amz-SignedHeaders=content-length%3Bcontent-type%3Bhost" +
        "&X-Amz-Signature=89418305fca8856f2a2ae45c329a3aa575fee131bc44e6c9660dde992a7714fe",
    );
  });

  // Same AWS doc vector as above, but the URL we CONNECT to is another host: only the signed Host
  // changes, so the signature must still be the one in the documentation.
  it("signs for `signedHost` while keeping the connection URL (host override)", async () => {
    const url = await presign({
      method: "GET",
      url: "https://gateway.internal:9000/test.txt",
      signedHost: "examplebucket.s3.amazonaws.com",
      region: "us-east-1",
      credentials,
      now: 1_369_353_600_000,
      expiresSeconds: 86_400,
    });
    expect(url.startsWith("https://gateway.internal:9000/test.txt?")).toBe(true);
    expect(url).toContain(
      "X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("signs different requests differently (method, host, header values)", async () => {
    const base = {
      url: "http://a.test/b/k.jpg",
      region: "local",
      credentials,
      now: 1_791_892_800_000,
      expiresSeconds: 60,
    };
    const signatureOf = async (extra: Partial<Parameters<typeof presign>[0]>) =>
      (await presign({ method: "GET", ...base, ...extra })).split("X-Amz-Signature=")[1];
    const reference = await signatureOf({});
    expect(await signatureOf({ method: "HEAD" })).not.toBe(reference);
    expect(await signatureOf({ url: "http://c.test/b/k.jpg" })).not.toBe(reference);
    expect(await signatureOf({ headers: { "content-length": "1" } })).not.toBe(reference);
    expect(await signatureOf({ expiresSeconds: 61 })).not.toBe(reference);
  });

  it("rejects an expiry outside 1..604800 seconds", async () => {
    const options = {
      method: "GET",
      url: "http://a.test/b/k",
      region: "local",
      credentials,
      now: 0,
    };
    await expect(presign({ ...options, expiresSeconds: 0 })).rejects.toThrow(RangeError);
    await expect(presign({ ...options, expiresSeconds: 604_801 })).rejects.toThrow(RangeError);
  });
});
