import type { Instant } from "@pactjoy/app";

/** Instants are ISO-8601 UTC with milliseconds: lossless for epoch ms and self-describing (ADR-0011). */
export function presentInstant(value: Instant): string {
  return new Date(value).toISOString();
}

export function presentInstantOrNull(value: Instant | null): string | null {
  return value === null ? null : presentInstant(value);
}
