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
) => Promise<
  | { readonly ok: true; readonly actor: A }
  | { readonly ok: false; readonly result: ApiResult; readonly headers?: HeadersInit }
>;

export interface PipelineOptions {
  readonly basePath: string;
  readonly allowedOrigins: readonly string[];
  readonly maxBodyBytes?: number;
}

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
}): Handler {
  const { routes, authenticate, options } = deps;
  const router = createRouter(routes);
  const cors = createCors(options.allowedOrigins);
  const maxBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  return async (request) => {
    const supplied = request.headers.get("x-request-id");
    const requestId = supplied !== null && UUID.test(supplied) ? supplied : crypto.randomUUID();
    const finish = (result: ApiResult, extra?: HeadersInit): Response => {
      const response = respond(result, extra);
      cors.decorate(request, response.headers);
      response.headers.set("X-Request-Id", requestId);
      return response;
    };

    try {
      const path = stripBasePath(new URL(request.url).pathname, options.basePath);
      if (path === null) return finish(failure(404, "RouteNotFound"));
      if (request.method === "OPTIONS") {
        const response = cors.preflight(request);
        response.headers.set("X-Request-Id", requestId);
        return response;
      }
      const match = router.match(request.method, path);
      if (match.kind === "notFound") return finish(failure(404, "RouteNotFound"));
      if (match.kind === "methodNotAllowed") {
        return finish(failure(405, "MethodNotAllowed"), { Allow: match.allow.join(", ") });
      }
      const auth = await authenticate(request);
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
    } catch {
      return finish(failure(500, "Internal", { requestId }));
    }
  };
}
