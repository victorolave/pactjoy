import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { API_ERROR_STATUS, type ApiErrorKind } from "../src/errors/api-error.ts";
import type { AppErrorKind } from "../src/errors/app-error.ts";
import { APP_ERROR_STATUS, appErrorResult } from "../src/errors/status-map.ts";

const KINDS = Object.keys(APP_ERROR_STATUS) as AppErrorKind[];
const kindsWith = (status: number) => KINDS.filter((k) => APP_ERROR_STATUS[k] === status).sort();

// Sub-unions already contained in the use case unions; not AppError members themselves.
const SUB_UNIONS = new Set(["ValidateCommitmentError", "EntryValueError", "EntryWindowError"]);

/** Every `*Error` name exported with `export type { ... }` from the app index, sorted. */
function exportedErrorNames(index: string): string[] {
  const names = [...index.matchAll(/export\s+type\s*\{([^}]*)\}/g)].flatMap((block) =>
    (block[1] ?? "").split(",").map((spec) =>
      spec
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)
        .pop(),
    ),
  );
  return [...new Set(names.filter((n): n is string => !!n && /Error$/.test(n)))].sort();
}

const identifiers = (text: string) => [...text.matchAll(/[A-Za-z_]\w*/g)].map((m) => m[0]);

/** Exported names missing from the `@pactjoy/app` import list and from the AppError union (exact, as sets). */
function errorCoverageGaps(index: string, source: string) {
  const expected = exportedErrorNames(index).filter((n) => !SUB_UNIONS.has(n));
  const imported = new Set(
    identifiers(
      /import\s+type\s*\{([^}]*)\}\s*from\s*["']@pactjoy\/app["']/.exec(source)?.[1] ?? "",
    ),
  );
  const members = new Set(
    identifiers(/export\s+type\s+AppError\s*=([^;]*);/.exec(source)?.[1] ?? ""),
  );
  return {
    imports: expected.filter((n) => !imported.has(n)),
    union: expected.filter((n) => !members.has(n)),
  };
}

describe("app error status map", () => {
  it("EM-S1..S5: 63 kinds, 36x422 4x403 7x404 15x409 1x410", () => {
    expect(KINDS).toHaveLength(63);
    expect(kindsWith(422)).toHaveLength(36);
    expect(kindsWith(403)).toEqual([
      "CommitmentNotOwned",
      "EntryNotOwned",
      "NotAMember",
      "NotOwner",
    ]);
    expect(kindsWith(404)).toEqual([
      "CircleNotFound",
      "CommitmentNotFound",
      "EntryNotFound",
      "HabitNotFound",
      "InviteNotFound",
      "MemberNotFound",
      "SeasonNotFound",
    ]);
    expect(kindsWith(409)).toHaveLength(15);
    expect(kindsWith(410)).toEqual(["InviteExpired"]);
  });

  it("StaleSeason (approval precondition) is 409", () => {
    expect(APP_ERROR_STATUS.StaleSeason).toBe(409);
  });

  it("EM-S8: the time-dependent window kinds are 409, OutsideSeason and IdempotencyKeyReused are 422", () => {
    for (const k of ["FutureDay", "WindowClosed", "BeforeSeasonStart"] as const) {
      expect(APP_ERROR_STATUS[k]).toBe(409);
    }
    expect(APP_ERROR_STATUS.OutsideSeason).toBe(422);
    expect(APP_ERROR_STATUS.IdempotencyKeyReused).toBe(422);
  });

  it("every status is a valid client-error code and every kind is a PascalCase identifier", () => {
    for (const k of KINDS) {
      expect([403, 404, 409, 410, 422]).toContain(APP_ERROR_STATUS[k]);
      expect(k).toMatch(/^[A-Z][A-Za-z]+$/);
    }
  });

  it("EM-S15: API-owned kinds never collide with app kinds", () => {
    const api = Object.keys(API_ERROR_STATUS) as ApiErrorKind[];
    expect(api.filter((k) => k in APP_ERROR_STATUS)).toEqual([]);
    expect(API_ERROR_STATUS.ConcurrencyConflict).toBe(409);
    expect(API_ERROR_STATUS.InviteCodeGenerationFailed).toBe(500);
    expect(API_ERROR_STATUS.Internal).toBe(500);
    expect(API_ERROR_STATUS.ServiceUnavailable).toBe(503);
  });

  it("EM-S6/S7: a missing kind and an extra stale kind are compile errors", () => {
    const missing = {} as Omit<typeof APP_ERROR_STATUS, "CircleFull">;
    // @ts-expect-error CircleFull is missing
    const a: Record<AppErrorKind, number> = missing;
    // @ts-expect-error Stale is not an app kind
    const b: Record<AppErrorKind, number> = { ...APP_ERROR_STATUS, Stale: 422 };
    expect([a, b]).toHaveLength(2);
  });

  it("EM-S16: the *Error types of @pactjoy/app, the imports and the AppError union match exactly", () => {
    const index = readFileSync(resolve(import.meta.dirname, "../../app/src/index.ts"), "utf8");
    const source = readFileSync(resolve(import.meta.dirname, "../src/errors/app-error.ts"), "utf8");
    expect(errorCoverageGaps(index, source)).toEqual({ imports: [], union: [] });
    expect(exportedErrorNames(index).length).toBe(27);
  });

  it("EM-S16: the scan compares exact names, so a new CircleError is detected", () => {
    const source = `import type { CreateCircleError, EntryError } from "@pactjoy/app";
export type AppError = CreateCircleError | EntryError;`;
    const index = `export type {
  CreateCircleError,
  type CircleError,
  EntryError,
  ValidateCommitmentError,
} from "./x.ts";
export type { Unrelated } from "./y.ts";`;
    expect(exportedErrorNames(index)).toEqual([
      "CircleError",
      "CreateCircleError",
      "EntryError",
      "ValidateCommitmentError",
    ]);
    expect(errorCoverageGaps(index, source)).toEqual({
      imports: ["CircleError"],
      union: ["CircleError"],
    });
    const fixed = source
      .replace("EntryError }", "EntryError, CircleError }")
      .replace("| EntryError;", "| EntryError | CircleError;");
    expect(errorCoverageGaps(index, fixed)).toEqual({ imports: [], union: [] });
  });
});

describe("appErrorResult", () => {
  it("maps the kind to its status and uses the kind as code and message", () => {
    expect(appErrorResult({ kind: "CircleFull" })).toEqual({
      status: 409,
      error: { code: "CircleFull", message: "CircleFull" },
    });
  });

  it("passes details through for kinds that carry them, without the kind", () => {
    expect(appErrorResult({ kind: "InvalidQuantity", reason: "negative" })).toEqual({
      status: 422,
      error: {
        code: "InvalidQuantity",
        message: "InvalidQuantity",
        details: { reason: "negative" },
      },
    });
    expect(appErrorResult({ kind: "InvalidClientRequestId", reason: "tooLong" })).toMatchObject({
      status: 422,
      error: { details: { reason: "tooLong" } },
    });
    expect(appErrorResult({ kind: "MissedNotAllowed", reason: "weekBound" })).toMatchObject({
      error: { details: { reason: "weekBound" } },
    });
  });
});
