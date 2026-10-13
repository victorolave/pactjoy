import { defineConfig } from "vitest/config";

// WARNING: a pure test (no S3 server) that lives in test/ MUST be listed here, or it runs in the
// `s3` project and demands Docker. Prefer putting it in src/.
const UNIT_ONLY_IN_TEST_DIR = ["test/boundary.test.ts"];

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 120_000,
    projects: [
      {
        // Pure tests: no container, no network.
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.ts", ...UNIT_ONLY_IN_TEST_DIR],
        },
      },
      {
        // Needs an S3 server: SeaweedFS through Testcontainers, or TEST_S3_ENDPOINT (see test/s3-source.ts).
        extends: true,
        test: {
          name: "s3",
          include: ["test/**/*.test.ts"],
          exclude: UNIT_ONLY_IN_TEST_DIR,
          fileParallelism: false,
        },
      },
    ],
  },
});
