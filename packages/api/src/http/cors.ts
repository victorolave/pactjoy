const ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE";
const ALLOW_HEADERS = "authorization, content-type, x-client-info, apikey, x-request-id";
const EXPOSE_HEADERS = "X-Request-Id, Retry-After";
const MAX_AGE_SECONDS = "600";

/**
 * Exact-origin allow-list (RT-R6). An empty list allows no browser origin.
 * A disallowed origin simply gets no CORS headers: the browser blocks it.
 */
export function createCors(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);
  const allowedOrigin = (request: Request): string | null => {
    const origin = request.headers.get("origin");
    return origin !== null && allowed.has(origin) ? origin : null;
  };

  /** Adds ACAO and the exposed headers for an allowed origin; Vary whenever origins are configured. */
  const decorate = (request: Request, headers: Headers): void => {
    if (allowed.size > 0) headers.append("Vary", "Origin");
    const origin = allowedOrigin(request);
    if (origin === null) return;
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Expose-Headers", EXPOSE_HEADERS);
  };

  const preflight = (request: Request): Response => {
    const headers = new Headers();
    decorate(request, headers);
    if (allowedOrigin(request) !== null) {
      headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
      headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
      headers.set("Access-Control-Max-Age", MAX_AGE_SECONDS);
    }
    return new Response(null, { status: 204, headers });
  };

  return { decorate, preflight };
}
