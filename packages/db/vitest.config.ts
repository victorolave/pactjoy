import { defineConfig } from "vitest/config";

// WARNING: a new pure test (fakes only, no Postgres) that lives in test/ MUST be listed
// here, or it runs in the `db` project and demands Docker. Prefer putting it in src/.
const UNIT_ONLY_IN_TEST_DIR = ["test/db-source.test.ts", "test/bootstrap-roles.test.ts"];

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
          include: ["src/**/*.test.ts", ...UNIT_ONLY_IN_TEST_DIR],
        },
      },
      {
        // Tests that need the migrated Postgres. Files share one database and
        // truncate between tests (design section 5), so they run one at a time.
        extends: true,
        test: {
          name: "db",
          include: ["test/**/*.test.ts"],
          exclude: UNIT_ONLY_IN_TEST_DIR,
          globalSetup: "./test/global-setup.ts",
          fileParallelism: false,
        },
      },
    ],
  },
});
