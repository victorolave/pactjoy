/**
 * Adapter-neutral contract suites (`exports: "./contracts"` in `package.json`).
 * They import vitest, so this subpath is a test-only surface: it is never
 * imported from `src/index.ts` or `src/testing/**`, which the api runtime
 * loads (see `no-vitest-in-testing.test.ts`).
 */
export {};
