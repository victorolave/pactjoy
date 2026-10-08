import type {
  CommitmentProgressView,
  CommitmentRecord,
  Habit,
  Instant,
  MeasureView,
  MemberProgressView,
  Season,
  SeasonProgressView,
  WeekSummaryView,
} from "@pactjoy/app";

/**
 * What a use-case view looks like after the API's JSON round trip: an `Instant` becomes an ISO
 * string and a branded string (an id, an invite code) becomes a plain string; a string literal
 * (a phase name) stays as it is. Numbers, booleans and `null` are unchanged. The client types a
 * response as `Serialized<View>` instead of copying the shape by hand, so the two cannot drift
 * apart silently (type-only coupling, ADR-0012).
 */
export type Serialized<T> = T extends Instant
  ? string
  : T extends string
    ? keyof T extends keyof string
      ? T
      : string
    : T extends number | boolean | null | undefined
      ? T
      : T extends readonly (infer Item)[]
        ? readonly Serialized<Item>[]
        : T extends object
          ? { readonly [Key in keyof T]: Serialized<T[Key]> }
          : T;

/** Habits are owner-only; the HTTP presenter deliberately omits ownerId. */
export type HabitDto = Omit<Serialized<Habit>, "ownerId">;
export type CommitmentDto =
  | (Pick<
      Serialized<CommitmentRecord>,
      "id" | "memberId" | "habitId" | "weightPercent" | "privacy"
    > & {
      readonly kind: "detail";
      readonly measure: Serialized<MeasureView>;
      /** Viewer GETs enrich this; mutation responses intentionally omit it. */
      readonly habit?: { readonly name: string; readonly icon: string | null };
    })
  | {
      readonly kind: "hidden";
      readonly id: string;
      readonly memberId: string;
      readonly weightPercent: number;
    };
export type SeasonDto = Omit<Serialized<Season>, "commitments"> & {
  readonly commitments: readonly CommitmentDto[];
};

/** The season progress reads as they arrive over the wire (change pwa-season-progress). */
export type SeasonProgress = Serialized<SeasonProgressView>;
export type MemberProgress = Serialized<MemberProgressView>;
export type CommitmentProgress = Serialized<CommitmentProgressView>;
export type WeekSummary = Serialized<WeekSummaryView>;
