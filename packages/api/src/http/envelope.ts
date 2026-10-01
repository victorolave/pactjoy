import type { ApiResult } from "./types.ts";

const FIXED_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

// Details can come from app errors that carry bigint; never throw on them.
const bigintSafe = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

const INTERNAL = { error: { code: "Internal", message: "Internal" } };

/** Serializes an ApiResult as `{data}` or `{error}`. The fixed headers always win. */
export function respond(result: ApiResult, extraHeaders: HeadersInit = {}): Response {
  const body = "error" in result ? { error: result.error } : { data: result.data };
  let text: string;
  let status = result.status;
  try {
    text = JSON.stringify(body, bigintSafe);
  } catch {
    text = JSON.stringify(INTERNAL);
    status = 500;
  }
  const headers = new Headers(extraHeaders);
  for (const [name, value] of Object.entries(FIXED_HEADERS)) headers.set(name, value);
  return new Response(text, { status, headers });
}
