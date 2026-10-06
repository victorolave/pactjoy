import {
  canSeeDetail,
  type Measure,
  type MeasureView,
  type Season,
  type SeasonMutationResult,
  type SeasonView,
  toDecimalString,
} from "@pactjoy/app";
import type { MemberId } from "@pactjoy/engine";
import { presentInstant, presentInstantOrNull } from "./time.ts";

export type CommitmentDto =
  | {
      readonly kind: "detail";
      readonly id: string;
      readonly memberId: string;
      readonly habitId: string;
      /** Present on viewer reads; mutation responses keep their existing shape. */
      readonly habit?: { readonly name: string; readonly icon: string | null };
      readonly weightPercent: number;
      readonly privacy: "visible" | "private";
      readonly measure: MeasureView;
    }
  | {
      readonly kind: "hidden";
      readonly id: string;
      readonly memberId: string;
      readonly weightPercent: number;
    };

export interface SeasonDto {
  readonly id: string;
  readonly circleId: string;
  readonly timeZone: string;
  readonly nominalStart: string;
  readonly actualStart: string | null;
  readonly lengthWeeks: number;
  readonly reviewCadenceWeeks: number;
  readonly status: string;
  readonly approvals: readonly { readonly memberId: string; readonly approvedAt: string }[];
  readonly pactClosedAt: string | null;
  readonly createdAt: string;
  readonly version: number;
  readonly pactRevision: number;
  readonly commitments: readonly CommitmentDto[];
}

/** Typed against the app's `MeasureView`, so drift is a compile error. Fractions become exact decimal strings. */
export function presentMeasure(measure: Measure): MeasureView {
  if (measure.unit === "done") {
    return measure;
  }
  const { target } = measure;
  return {
    unit: measure.unit,
    customLabel: measure.customLabel,
    precision: measure.precision,
    target:
      target.direction === "reach"
        ? {
            direction: "reach",
            minimum: toDecimalString(target.minimum),
            ideal: toDecimalString(target.ideal),
          }
        : {
            direction: "limit",
            ideal: toDecimalString(target.ideal),
            tolerance: toDecimalString(target.tolerance),
          },
    schedule: measure.schedule,
  };
}

/**
 * `viewer` is the member asking and decides which private commitments are shown: their own in
 * full (marked `private`), everyone else's hidden (SV-R1, Q8). Every caller has one: a read or a
 * mutation result carries the member behind the actor.
 */
export function presentSeason(season: Season, viewer: MemberId): SeasonDto {
  return {
    id: season.id,
    circleId: season.circleId,
    timeZone: season.timeZone,
    nominalStart: season.nominalStart,
    actualStart: season.actualStart,
    lengthWeeks: season.lengthWeeks,
    reviewCadenceWeeks: season.reviewCadenceWeeks,
    status: season.status,
    approvals: season.approvals.map((approval) => ({
      memberId: approval.memberId,
      approvedAt: presentInstant(approval.approvedAt),
    })),
    pactClosedAt: presentInstantOrNull(season.pactClosedAt),
    createdAt: presentInstant(season.createdAt),
    version: season.version,
    pactRevision: season.pactRevision,
    commitments: season.commitments.map(
      (commitment): CommitmentDto =>
        canSeeDetail(commitment, viewer)
          ? {
              kind: "detail",
              id: commitment.id,
              memberId: commitment.memberId,
              habitId: commitment.habitId,
              weightPercent: commitment.weightPercent,
              privacy: commitment.privacy,
              measure: presentMeasure(commitment.measure),
            }
          : {
              kind: "hidden",
              id: commitment.id,
              memberId: commitment.memberId,
              weightPercent: commitment.weightPercent,
            },
    ),
  };
}

/** A season (read or mutation result) projected for the member who is asking. */
export const presentSeasonFor = ({ season, viewerId }: SeasonMutationResult): SeasonDto =>
  presentSeason(season, viewerId);

/** Enrich detail only, after the app authorized and batch-read the visible habits. */
export function presentSeasonView(view: SeasonView): SeasonDto {
  const dto = presentSeasonFor(view);
  const habits = new Map<string, SeasonView["habits"][number]>(
    view.habits.map((habit) => [habit.id, habit]),
  );
  return {
    ...dto,
    commitments: dto.commitments.map((commitment) => {
      if (commitment.kind === "hidden") return commitment;
      const habit = habits.get(commitment.habitId);
      if (!habit) throw new Error(`habit ${commitment.habitId} not found`);
      return { ...commitment, habit: { name: habit.name, icon: habit.icon } };
    }),
  };
}
