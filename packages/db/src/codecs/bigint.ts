const INTEGER = /^-?\d+$/;

/**
 * int8 text -> `bigint`. The driver would otherwise return a string, and a
 * JS number silently loses precision beyond 2^53 (ADR-0004: exact fractions).
 *
 * @throws {Error} on text that is not a plain integer.
 */
export function parseInt8(text: string): bigint {
  if (!INTEGER.test(text)) throw new Error(`Unsupported int8 value: ${JSON.stringify(text)}`);
  return BigInt(text);
}

/** `bigint` -> decimal text, bound with `$n::int8`. */
export function formatInt8(value: bigint): string {
  return value.toString();
}
