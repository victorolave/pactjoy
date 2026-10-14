import { describe, expect, it } from "vitest";
import { encodePath, encodeRfc3986 } from "./uri.ts";

describe("encodeRfc3986", () => {
  it("leaves the unreserved characters alone", () => {
    expect(encodeRfc3986("AZaz09-_.~")).toBe("AZaz09-_.~");
  });

  it("percent-encodes everything else in uppercase hex, including !'()* that encodeURIComponent keeps", () => {
    expect(encodeRfc3986("a b/c+d=e&f")).toBe("a%20b%2Fc%2Bd%3De%26f");
    expect(encodeRfc3986("!'()*")).toBe("%21%27%28%29%2A");
  });

  it("encodes non-ASCII as UTF-8 bytes", () => {
    expect(encodeRfc3986("á")).toBe("%C3%A1");
  });
});

describe("encodePath", () => {
  it("keeps the slashes and encodes each segment once", () => {
    expect(encodePath("/storage/v1/s3/entry-photos/o/ab.jpg")).toBe(
      "/storage/v1/s3/entry-photos/o/ab.jpg",
    );
    expect(encodePath("/a b/c%20d")).toBe("/a%20b/c%20d");
  });

  it("does not double-encode an already encoded path", () => {
    expect(encodePath(encodePath("/a b"))).toBe("/a%20b");
  });
});
