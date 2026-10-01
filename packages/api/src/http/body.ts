import type { ApiResult } from "./types.ts";

export const DEFAULT_MAX_BODY_BYTES = 16 * 1024;

export type BodyResult =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly result: ApiResult };

const fail = (status: number, code: string, details?: Record<string, unknown>): BodyResult => ({
  ok: false,
  result: { status, error: { code, message: code, ...(details ? { details } : {}) } },
});

const tooLarge = () => fail(413, "PayloadTooLarge");

/** Reads at most `maxBytes`, counting the real stream (a Content-Length can lie or be absent). */
async function readCapped(request: Request, maxBytes: number): Promise<Uint8Array | null> {
  const declared = Number(request.headers.get("content-length"));
  if (declared > maxBytes) {
    await request.body?.cancel();
    return null;
  }
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Body of a request: `undefined` when empty (the route decides whether that is
 * acceptable), else a parsed JSON object. Unknown-field checks belong to the route schemas.
 */
export async function readJsonBody(request: Request, maxBytes: number): Promise<BodyResult> {
  const bytes = await readCapped(request, maxBytes);
  if (bytes === null) return tooLarge();
  if (bytes.byteLength === 0) return { ok: true, body: undefined };
  if (request.method === "GET" || request.method === "DELETE") {
    return fail(422, "InvalidRequest", { reason: "bodyNotAllowed" });
  }
  const [mediaType, ...params] = (request.headers.get("content-type") ?? "")
    .split(";")
    .map((part) => part.trim().toLowerCase());
  if (mediaType !== "application/json") return fail(415, "UnsupportedMediaType");
  for (const param of params) {
    const [name, value] = param.split("=").map((part) => part.trim());
    if (name === "charset" && value?.replace(/^"|"$/g, "") !== "utf-8") {
      return fail(415, "UnsupportedMediaType");
    }
  }
  try {
    // ignoreBOM keeps a leading BOM in the text, so JSON.parse rejects it: UTF-8 stays strict.
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { ok: true, body: parsed };
    }
  } catch {
    // falls through to the single InvalidJson answer
  }
  return fail(400, "InvalidJson");
}
