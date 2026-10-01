import type { Logger } from "../composition/logger.ts";
import { DEFAULT_MAX_BODY_BYTES, readJsonBody } from "./body.ts";
import { createCors } from "./cors.ts";
import { respond } from "./envelope.ts";
import { createRouter, type RouteSpec, stripBasePath } from "./router.ts";
import type { ApiResult, Handler } from "./types.ts";

export interface RequestContext<A> {
  readonly actor: A;
  readonly params: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly requestId: string;
}

export interface PipelineRoute<A> extends RouteSpec {
  handle(ctx: RequestContext<A>): Promise<ApiResult>;
}

/** Injected by the composition (C2): a verified actor, or the response to send. */
export type Authenticate<A> = (
  request: Request,
  info: { readonly requestId: string; readonly route: PipelineRoute<A> },
) => Promise<
  | { readonly ok: true; readonly actor: A }
  | { readonly ok: false; readonly result: ApiResult; readonly headers?: HeadersInit }
>;

export interface PipelineOptions {
  readonly basePath: string;
  readonly allowedOrigins: readonly string[];
  readonly maxBodyBytes?: number;
}

/**
 * Seam for thrown-error mapping and logging (C3b, C7d). Return a result to
 * answer with it, or undefined for the default 500 `Internal` with the requestId.
 */
export type OnError = (e: unknown, info: { readonly requestId: string }) => ApiResult | undefined;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const failure = (status: number, code: string, details?: Record<string, unknown>): ApiResult => ({
  status,
  error: { code, message: code, ...(details ? { details } : {}) },
});

/**
 * Order (RT, binding): requestId, base path, CORS preflight (no auth), route
 * 404/405, auth, body, controller; anything thrown becomes a 500. Never rejects.
 */
export function createPipeline<A>(deps: {
  readonly routes: readonly PipelineRoute<A>[];
  readonly authenticate: Authenticate<A>;
  readonly options: PipelineOptions;
  readonly onError?: OnError;
  /** One `request` info line per request (SF3): pattern, status, duration, error code; no ids or secrets. */
  readonly logger?: Logger;
  /** Millisecond clock for `durationMs`; injected so tests are deterministic. */
  readonly now?: () => number;
}): Handler {
  const { routes, authenticate, options, onError, logger } = deps;
  const now = deps.now ?? Date.now;
  if (options.basePath !== "" && !/^\/.*[^/]$/.test(options.basePath)) {
    throw new Error(`basePath must start with "/" and not end with "/": ${options.basePath}`);
  }
  if (
    options.maxBodyBytes !== undefined &&
    !(Number.isSafeInteger(options.maxBodyBytes) && options.maxBodyBytes > 0)
  ) {
    throw new Error(`maxBodyBytes must be a positive integer: ${options.maxBodyBytes}`);
  }
  const router = createRouter(routes);
  const cors = createCors(options.allowedOrigins);
  const maxBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async (request) => {
    const supplied = request.headers.get("x-request-id");
    const requestId = supplied !== null && UUID.test(supplied) ? supplied : crypto.randomUUID();
    const started = now();
    const method = request.method.toUpperCase();
    // The pattern, never the raw path (it carries ids); "unmatched" when no route matched.
    let route = "unmatched";
    const logLine = (status: number, code?: string) => {
      try {
        logger?.info("request", {
          requestId,
          method,
          route,
          status,
          durationMs: now() - started,
          ...(code === undefined ? {} : { code }),
        });
      } catch {
        // A logging failure must never fail the request.
      }
    };
    const finish = (result: ApiResult, extra?: HeadersInit): Response => {
      const response = respond(result, extra);
      cors.decorate(request, response.headers);
      response.headers.set("X-Request-Id", requestId);
      logLine(response.status, "error" in result ? result.error.code : undefined);
      return response;
    };

    try {
      // Deviation from the design order (preflight first): the base path is checked first,
      // so a request outside it never gets CORS handling. Intended; do not reorder.
      const path = stripBasePath(new URL(request.url).pathname, options.basePath);
      if (path === null) return finish(failure(404, "RouteNotFound"));
      if (method === "OPTIONS") {
        const response = cors.preflight(request);
        response.headers.set("X-Request-Id", requestId);
        logLine(response.status);
        return response;
      }
      const match = router.match(method, path);
      if (match.kind === "notFound") return finish(failure(404, "RouteNotFound"));
      if (match.kind === "methodNotAllowed") {
        return finish(failure(405, "MethodNotAllowed"), { Allow: match.allow.join(", ") });
      }
      route = match.route.pattern;
      const auth = await authenticate(request, { requestId, route: match.route });
      if (!auth.ok) return finish(auth.result, auth.headers);
      const body = await readJsonBody(request, maxBytes);
      if (!body.ok) return finish(body.result);
      return finish(
        await match.route.handle({
          actor: auth.actor,
          params: match.params,
          body: body.body,
          requestId,
        }),
      );
    } catch (e) {
      const fallback = failure(500, "Internal", { requestId });
      try {
        return finish(onError?.(e, { requestId }) ?? fallback);
      } catch {
        return finish(fallback);
      }
    }
  };
}
