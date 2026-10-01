import { describe, expect, it } from "vitest";
import { readJsonBody } from "../src/http/body.ts";

const MAX = 1024;
const post = (body: BodyInit | null, headers: Record<string, string> = {}, method = "POST") =>
  new Request("http://x/api/habits", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body,
  });
const code = (r: Awaited<ReturnType<typeof readJsonBody>>) =>
  r.ok ? "ok" : `${r.result.status} ${"error" in r.result ? r.result.error.code : ""}`;

const stream = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(chunk);
      c.close();
    },
  });
const streamed = (chunks: Uint8Array[], headers: Record<string, string> = {}) =>
  new Request("http://x/api/habits", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: stream(chunks),
    duplex: "half",
  } as RequestInit);

describe("readJsonBody", () => {
  it("parses a JSON object", async () => {
    expect(await readJsonBody(post('{"a":1}'), MAX)).toEqual({ ok: true, body: { a: 1 } });
  });

  it("an empty body is absent (undefined), left to the route", async () => {
    expect(await readJsonBody(post(null), MAX)).toEqual({ ok: true, body: undefined });
    expect(await readJsonBody(post(""), MAX)).toEqual({ ok: true, body: undefined });
  });

  it("RV-S2 (adapted): malformed JSON and non-object top levels are 400 InvalidJson", async () => {
    for (const text of ["{bad json", "[]", '"x"', "null", "7"]) {
      expect(code(await readJsonBody(post(text), MAX))).toBe("400 InvalidJson");
    }
  });

  it("invalid UTF-8 and lone-surrogate escapes in text fail the decode or parse path", async () => {
    const invalid = new Uint8Array([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]);
    expect(code(await readJsonBody(post(invalid), MAX))).toBe("400 InvalidJson");
  });

  it("__proto__ stays an own data key (no pollution)", async () => {
    const r = await readJsonBody(post('{"__proto__":{"polluted":1}}'), MAX);
    expect(r.ok && Object.keys(r.body as object)).toEqual(["__proto__"]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("415 on a non-JSON content type with a body; charset is accepted", async () => {
    expect(code(await readJsonBody(post("{}", { "content-type": "text/plain" }), MAX))).toBe(
      "415 UnsupportedMediaType",
    );
    expect(
      code(
        await readJsonBody(post("{}", { "content-type": "Application/JSON; charset=utf-8" }), MAX),
      ),
    ).toBe("ok");
  });

  it("GET and DELETE must not carry a body", async () => {
    const del = new Request("http://x/a", { method: "DELETE", body: "{}" });
    const r = await readJsonBody(del, MAX);
    expect(code(r)).toBe("422 InvalidRequest");
    expect(!r.ok && "error" in r.result && r.result.error.details).toEqual({
      reason: "bodyNotAllowed",
    });
    expect(await readJsonBody(new Request("http://x/a"), MAX)).toEqual({
      ok: true,
      body: undefined,
    });
  });

  it("only utf-8 is accepted as a charset: anything else is 415", async () => {
    for (const ct of ["application/json; charset=latin1", "application/json;charset=utf-16"]) {
      expect(code(await readJsonBody(post("{}", { "content-type": ct }), MAX))).toBe(
        "415 UnsupportedMediaType",
      );
    }
    for (const ct of ["application/json; charset=UTF-8", 'application/json; charset="utf-8"']) {
      expect(code(await readJsonBody(post("{}", { "content-type": ct }), MAX))).toBe("ok");
    }
  });

  it("a UTF-8 BOM is InvalidJson (ignoreBOM keeps it, so the decode is strict)", async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]);
    expect(code(await readJsonBody(post(bom), MAX))).toBe("400 InvalidJson");
  });

  it("RV-S4: an over-limit Content-Length is 413 without reading", async () => {
    // A stream that never yields or closes: reading it would hang the test.
    const body = new ReadableStream<Uint8Array>({});
    const req = new Request("http://x/a", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(MAX + 1) },
      body,
      duplex: "half",
    } as RequestInit);
    expect(code(await readJsonBody(req, MAX))).toBe("413 PayloadTooLarge");
    expect(req.bodyUsed).toBe(true); // the fast-reject cancelled the stream
  });

  it("RV-S4: exactly the limit is accepted, one byte more is 413", async () => {
    const pad = (n: number) => `{"a":"${"x".repeat(n - 8)}"}`;
    expect(code(await readJsonBody(post(pad(MAX)), MAX))).toBe("ok");
    expect(code(await readJsonBody(post(pad(MAX + 1)), MAX))).toBe("413 PayloadTooLarge");
  });

  it("RV-S5: a lying Content-Length cannot bypass the cap", async () => {
    const big = new Uint8Array(5 * 1024).fill(0x20);
    expect(code(await readJsonBody(streamed([big], { "content-length": "10" }), MAX))).toBe(
      "413 PayloadTooLarge",
    );
  });

  it("RV-S6: a chunked stream without Content-Length is counted and capped", async () => {
    const chunk = new Uint8Array(400).fill(0x20);
    expect(code(await readJsonBody(streamed([chunk, chunk, chunk]), MAX))).toBe(
      "413 PayloadTooLarge",
    );
  });
});
