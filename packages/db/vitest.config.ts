import { defineConfig } from "vitest/config";

// WARNING: a new pure test (fakes only, no Postgres) that lives in test/ MUST be listed
// here, or it runs in the `db` project and demands Docker. Prefer putting it in src/.
const UNIT_ONLY_IN_TEST_DIR = [
  "test/db-source.test.ts",
  "test/bootstrap-roles.test.ts",
  "test/boundary.test.ts",
];

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    projects: [
      {
        // Pure tests (fakes only): no globalSetup, so no Docker or Postgres.
        extends: true,
        test: {
          name: "unit",
          // The dev seed's own tests run on the in-memory app harness: no database either.
          include: ["src/**/*.test.ts", "scripts/**/*.test.ts", ...UNIT_ONLY_IN_TEST_DIR],
        },
      },
      {
        // Tests that need the migrated Postgres. Files share one database and
        // run one at a time; test/isolation.ts truncates before every test (design section 5).
        extends: true,
        test: {
          name: "db",
          include: ["test/**/*.test.ts"],
          exclude: UNIT_ONLY_IN_TEST_DIR,
          globalSetup: "./test/global-setup.ts",
          fileParallelism: false,
          setupFiles: ["./test/isolation.ts"],
        },
      },
    ],
  },
});
