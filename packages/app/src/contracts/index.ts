/**
 * Adapter-neutral contract suites (`exports: "./contracts"` in `package.json`).
 * They import vitest, so this subpath is a test-only surface: it is never
 * imported from `src/index.ts` or `src/testing/**`, which the api runtime
 * loads (see `no-vitest-in-testing.test.ts`). An adapter package runs each
 * suite with a factory returning a fresh `{ uow }` over an empty store.
 */

export type { ContractSubject } from "./fixtures.ts";
export {
  describeCircleGuardContract,
  describeSeasonGuardContract,
} from "./guard-version.contract.ts";
export { describeHabitRepositoryContract } from "./habit.contract.ts";
export { describeUnitOfWorkContract } from "./unit-of-work.contract.ts";
