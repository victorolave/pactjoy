import type {
  Actor,
  Clock,
  IdGenerator,
  RandomSource,
  Repositories,
  Result,
  TimeZone,
  UnitOfWork,
} from "@pactjoy/app";
import type { TokenVerifier } from "../auth/token-verifier.port.ts";
import type { Logger } from "../composition/logger.ts";
import { apiFailure } from "../errors/api-error.ts";
import type { AppError } from "../errors/app-error.ts";
import { appErrorResult } from "../errors/status-map.ts";
import type { PipelineRoute } from "../http/pipeline.ts";
import type { ApiResult } from "../http/types.ts";
import { type Parsed, parse, type Schema } from "../validation/schema.ts";

/** Ports only (ADR-0011): no env access, no vendor imports. */
export interface ApiDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly clock: Clock;
  readonly timeZone: TimeZone;
  readonly ids: IdGenerator;
  readonly random: RandomSource;
  readonly tokenVerifier: TokenVerifier;
  readonly logger: Logger;
  /** Decides which thrown errors mean "database unavailable" (503); injected by the shell. */
  readonly isUnavailable?: (e: unknown) => boolean;
}

export type Route = PipelineRoute<Actor>;

const invalid = (issues: readonly unknown[]): ApiResult => apiFailure("InvalidRequest", { issues });

/**
 * Validates path params then body (a path failure wins). Each route decides whether a missing
 * body is acceptable (`emptyBody: "object"`), as `parse` is opt-in.
 */
export function validate<P, B>(
  ctx: { readonly params: unknown; readonly body: unknown },
  schemas: { readonly params: Schema<P>; readonly body: Schema<B>; readonly emptyBody?: "object" },
):
  | { readonly ok: true; readonly params: P; readonly body: B }
  | { readonly ok: false; readonly result: ApiResult } {
  const params: Parsed<P> = parse(schemas.params, ctx.params, { emptyBody: "object" });
  if (!params.ok) return { ok: false, result: invalid(params.issues) };
  const body = parse(schemas.body, ctx.body, schemas.emptyBody ? { emptyBody: "object" } : {});
  if (!body.ok) return { ok: false, result: invalid(body.issues) };
  return { ok: true, params: params.value, body: body.value };
}

/** Use-case Result to an API result: the app error through the C3b map, success presented. */
export const toResult = <T>(
  result: Result<T, AppError>,
  status: 200 | 201,
  present: (value: T) => unknown,
): ApiResult =>
  result.ok ? { status, data: present(result.value) } : appErrorResult(result.error);
