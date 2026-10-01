import type { ApiResult } from "./types.ts";

const FIXED_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
} as const;

// Details come from app errors that can carry bigint; data never may (presenters emit strings).
const bigintSafe = (_key: string, value: unknown) =>
  typeof value === "bigint" ? value.toString() : value;

const safeDetails = (details: Readonly<Record<string, unknown>>): unknown =>
  JSON.parse(JSON.stringify(details, bigintSafe));

/**
 * Serializes an ApiResult as `{data}` or `{error}`. The fixed headers always win.
 * Serialization failures THROW: the pipeline's catch owns the 500 (requestId, onError).
 */
export function respond(result: ApiResult, extraHeaders: HeadersInit = {}): Response {
  const body =
    "error" in result
      ? {
          error: {
            ...result.error,
            ...(result.error.details ? { details: safeDetails(result.error.details) } : {}),
          },
        }
      : { data: result.data === undefined ? null : result.data };
  const headers = new Headers(extraHeaders);
  for (const [name, value] of Object.entries(FIXED_HEADERS)) headers.set(name, value);
  return new Response(JSON.stringify(body), { status: result.status, headers });
}
