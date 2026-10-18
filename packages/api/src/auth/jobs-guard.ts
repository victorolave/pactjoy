import type { Authenticate } from "../http/pipeline.ts";

/** Who calls a job route: the trigger, never a user (ADR-0017, design J9). */
export interface JobCaller {
  readonly kind: "job";
}

const MAX_HEADER_LENGTH = 1024;
const BEARER = /^Bearer (\S+)$/;
const encoder = new TextEncoder();

const UNAUTHORIZED = {
  ok: false,
  result: { status: 401, error: { code: "Unauthorized", message: "Unauthorized" } },
} as const;

/**
 * Whether two strings are equal, in time that depends on neither their content nor where they
 * differ: both are hashed to 32 bytes first (so lengths never short-circuit), then every byte is
 * compared with no early exit.
 */
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [x, y] = await Promise.all(
    [a, b].map(
      async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))),
    ),
  );
  let difference = 0;
  for (let i = 0; i < 32; i++) difference |= (x?.[i] ?? 0) ^ (y?.[i] ?? 0);
  return difference === 0;
}

/**
 * `Authorization: Bearer <API_JOBS_SECRET>` -> the job caller. Every refusal is the same 401 and
 * the header is never logged or echoed. A user's JWT can never match, and this guard is mounted
 * only on the jobs pipeline, so the secret can never reach a user route either.
 */
export function createJobsGuard(secret: string): Authenticate<JobCaller> {
  return async (request) => {
    const header = request.headers.get("authorization") ?? "";
    const presented = header.length <= MAX_HEADER_LENGTH ? BEARER.exec(header)?.[1] : undefined;
    if (presented === undefined || !(await constantTimeEqual(presented, secret))) {
      return UNAUTHORIZED;
    }
    return { ok: true, actor: { kind: "job" } };
  };
}
