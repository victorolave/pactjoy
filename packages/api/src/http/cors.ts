const ALLOW_METHODS = "GET, POST, PUT, PATCH, DELETE";
const ALLOW_HEADERS = "authorization, content-type, x-client-info, apikey";
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

  return {
    /** Adds ACAO and Vary to an allowed origin; requests without Origin are untouched. */
    decorate(request: Request, headers: Headers): void {
      const origin = allowedOrigin(request);
      if (origin === null) return;
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
    },
    preflight(request: Request): Response {
      const headers = new Headers();
      if (allowedOrigin(request) !== null) {
        this.decorate(request, headers);
        headers.set("Access-Control-Allow-Methods", ALLOW_METHODS);
        headers.set("Access-Control-Allow-Headers", ALLOW_HEADERS);
        headers.set("Access-Control-Max-Age", MAX_AGE_SECONDS);
      }
      return new Response(null, { status: 204, headers });
    },
  };
}
