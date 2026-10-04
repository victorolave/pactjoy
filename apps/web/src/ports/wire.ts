import type { Instant } from "@pactjoy/app";

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
