import type { CircleId, Instant, MyCircleView } from "@pactjoy/app";
import { describe, expectTypeOf, it } from "vitest";
import type { Serialized } from "./wire.ts";

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
