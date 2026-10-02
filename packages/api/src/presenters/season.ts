import {
  type CommitmentRecord,
  canSeeDetail,
  type Measure,
  type MeasureView,
  type Season,
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

const showsDetail = (commitment: CommitmentRecord, viewer: MemberId | null): boolean =>
  viewer === null ? commitment.privacy === "visible" : canSeeDetail(commitment, viewer);

/**
 * `viewer` is the member asking and decides which private commitments are shown: their own in
 * full (marked `private`), everyone else's hidden (SV-R1, Q8). `null` means no viewer is known
 * and stays conservative: private commitments are hidden for EVERYONE, owner included (decision
 * #5018).
 */
export function presentSeason(season: Season, viewer: MemberId | null): SeasonDto {
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
        showsDetail(commitment, viewer)
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

/** The mutation routes carry no viewer yet (S6b): the conservative projection. */
export const presentSeasonWithoutViewer = (season: Season): SeasonDto =>
  presentSeason(season, null);
