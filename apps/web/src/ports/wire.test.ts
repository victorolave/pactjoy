import type { CircleId, Instant, MyCircleView } from "@pactjoy/app";
import { describe, expectTypeOf, it } from "vitest";
import type {
  CommitmentProgress,
  MemberProgress,
  SeasonProgress,
  Serialized,
  WeekSummary,
} from "./wire.ts";

describe("Serialized", () => {
  it("turns an Instant into a string and a branded id into a plain string", () => {
    expectTypeOf<Serialized<Instant>>().toEqualTypeOf<string>();
    expectTypeOf<Serialized<CircleId>>().toEqualTypeOf<string>();
  });

  it("keeps string literals, numbers, booleans and null", () => {
    expectTypeOf<Serialized<"a" | "b">>().toEqualTypeOf<"a" | "b">();
    expectTypeOf<Serialized<4 | 6>>().toEqualTypeOf<4 | 6>();
    expectTypeOf<Serialized<boolean>>().toEqualTypeOf<boolean>();
    expectTypeOf<Serialized<number | null>>().toEqualTypeOf<number | null>();
  });

  it("maps arrays and objects recursively, nulls included", () => {
    type Wire = Serialized<MyCircleView>;
    type Circle = NonNullable<Wire["circle"]>;
    expectTypeOf<Circle["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Circle["members"][number]["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Circle["members"][number]["joinedAt"]>().toEqualTypeOf<string>();
    expectTypeOf<Circle["members"][number]["isYou"]>().toEqualTypeOf<boolean>();
    expectTypeOf<NonNullable<Circle["invite"]>["code"]>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Circle["invite"]>["expiresAt"]>().toEqualTypeOf<string>();
    expectTypeOf<NonNullable<Wire["season"]>["week"]>().toEqualTypeOf<number | null>();
    expectTypeOf<NonNullable<Wire["season"]>["phase"]>().toEqualTypeOf<
      "pactOpen" | "notStarted" | "active" | "ended"
    >();
  });
});

describe("progress wire types", () => {
  type Season = Extract<SeasonProgress, { state: "active" | "ended" }>;
  type Peer = Extract<MemberProgress, { scope: "others" }>;
  type Detail = Extract<CommitmentProgress, { state: "active" | "ended" }>;
  type Cell = Detail["weeks"][number]["cells"][number];

  it("carries MemberId and LocalDate as plain strings and keeps nullable metrics", () => {
    expectTypeOf<Season["viewerId"]>().toEqualTypeOf<string>();
    expectTypeOf<Season["calendar"]["today"]>().toEqualTypeOf<string>();
    expectTypeOf<Season["standings"]["rows"][number]["rank"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Peer["consistency"]>().toEqualTypeOf<number | null>();
    expectTypeOf<Cell["evidence"][number]["recordedOn"]>().toEqualTypeOf<string>();
    expectTypeOf<WeekSummary["headline"]>().toEqualTypeOf<"best" | "difficult" | null>();
  });

  it("limits a peer's private commitment to its reference, weight and points", () => {
    type Hidden = Extract<Peer["commitments"][number], { kind: "hidden" }>;
    expectTypeOf<keyof Hidden>().toEqualTypeOf<
      "kind" | "commitmentId" | "weightPercent" | "points"
    >();
  });
});
