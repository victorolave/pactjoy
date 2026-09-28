/**
 * D6/D7/R5: prorates a partial-week's governing figures by active days,
 * rounded half-up to the commitment's own whole unit — this is `Fraction`'s
 * only other call site for `roundHalfUp` besides `display/` (D10). Decimal
 * and custom units round the same way (R5: 3.5km over 1 active day -> 1km).
 * If the governing figure prorates to 0 — N for `timesPerWeek`; ideal for
 * `weeklyTotal` reach; tolerance for `weeklyTotal` limit — the whole week
 * is fully paused (D7), signaled by returning `null`.
 */
import type { Target } from "../commitment/commitment.ts";
import type { Fraction } from "../fraction/fraction.ts";
import { div, fromInt, isZero, mul, roundHalfUp } from "../fraction/fraction.ts";

const DAYS_PER_WEEK = fromInt(7);

function proratedWholeUnit(value: Fraction, activeDays: number): Fraction {
  return fromInt(Number(roundHalfUp(div(mul(value, fromInt(activeDays)), DAYS_PER_WEEK))));
}

/** D6: prorates `timesPerWeek`'s session count N. D7: `null` means N prorated to 0 — the week is fully paused. */
export function prorateSessionCount(times: number, activeDays: number): number | null {
  const prorated = Number(
    roundHalfUp(div(mul(fromInt(times), fromInt(activeDays)), DAYS_PER_WEEK)),
  );
  return prorated === 0 ? null : prorated;
}

/**
 * D6: prorates a `weeklyTotal` `reach` target's minimum and ideal. D7:
 * `null` means the governing ideal prorated to 0 — the week is fully paused.
 */
export function prorateReachTarget(
  target: { readonly minimum: Fraction; readonly ideal: Fraction },
  activeDays: number,
): Target | null {
  const ideal = proratedWholeUnit(target.ideal, activeDays);
  if (isZero(ideal)) return null;
  return { direction: "reach", minimum: proratedWholeUnit(target.minimum, activeDays), ideal };
}

/**
 * D6: prorates a `weeklyTotal` `limit` target's ideal and tolerance. D7:
 * `null` means the governing tolerance prorated to 0 — the week is fully
 * paused, even when `ideal` is legitimately 0 (e.g. "0 apuestas/semana").
 */
export function prorateLimitTarget(
  target: { readonly ideal: Fraction; readonly tolerance: Fraction },
  activeDays: number,
): Target | null {
  const tolerance = proratedWholeUnit(target.tolerance, activeDays);
  if (isZero(tolerance)) return null;
  return { direction: "limit", ideal: proratedWholeUnit(target.ideal, activeDays), tolerance };
}
