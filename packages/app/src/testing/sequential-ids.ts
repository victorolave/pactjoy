import type { IdGenerator } from "../ports/id-generator.ts";

/** Deterministic {@link IdGenerator} for tests: `${prefix}-1`, `${prefix}-2`, ... */
export function createSequentialIdGenerator(prefix = "id"): IdGenerator {
  let counter = 0;

  return {
    next(): string {
      counter += 1;
      return `${prefix}-${counter}`;
    },
  };
}
