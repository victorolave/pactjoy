/**
 * Opaque id generation (ADR-0008, D9). `crypto` is not in the ES2022 lib
 * and its concrete source varies per runtime, so production adapters live
 * in `src/adapters/`; this package ships only a deterministic in-memory
 * one for tests (`testing/sequential-ids.ts`).
 */
export interface IdGenerator {
  next(): string;
}
