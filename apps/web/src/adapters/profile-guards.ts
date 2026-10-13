import type { ProfileSummaryDto } from "../ports/wire.ts";

/**
 * Runtime check for the Perfil summary (`GET /me/profile`, ADR-0011 Q23). Structure only: the app
 * owns the rules, this keeps a wrong or truncated 2xx from reaching a screen as data (it becomes
 * ApiError("Internal")). The list never carries `graduated`, so a payload that does is rejected.
 */

type Check = (value: unknown) => boolean;
type Rec = Record<string, unknown>;

const isRec = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const id: Check = (v) => typeof v === "string" && v.length > 0;
const text: Check = (v) => typeof v === "string";
const bool: Check = (v) => typeof v === "boolean";
const count: Check = (v) => typeof v === "number" && Number.isInteger(v) && v >= 0;
const nullable =
  (check: Check): Check =>
  (v) =>
    v === null || check(v);
const oneOf =
  (...options: readonly unknown[]): Check =>
  (v) =>
    options.includes(v);
const list =
  (check: Check): Check =>
  (v) =>
    Array.isArray(v) && v.every(check);
const shape =
  (fields: Readonly<Record<string, Check>>): Check =>
  (v) =>
    isRec(v) && Object.entries(fields).every(([key, check]) => check(v[key]));

export const isProfileSummary = (data: unknown): data is ProfileSummaryDto =>
  shape({
    consistency: shape({
      kept: count,
      counted: count,
      percent: nullable(count),
      closedSeasons: count,
      inProgress: bool,
    }),
    habits: list(
      shape({
        habitId: id,
        name: text,
        icon: nullable(text),
        stage: oneOf("new", "developing", "integrated"),
        inCurrentSeason: bool,
      }),
    ),
  })(data);
