import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { userId } from "@pactjoy/app";
import { describe, expect, it } from "vitest";
import { createGoTrueIdentityAdmin } from "../src/adapters/gotrue-identity-admin.ts";
import { describeEnvError, loadApiEnv } from "../src/composition/config.ts";

// Confinement of the identity administration credential (ADR-0019). The key has full project
// power, so the places that may even NAME it are a short list, and nothing in the repository may
// hold a key-shaped literal. The needles are built from parts so this file never matches itself.
const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const SKIPPED_DIRS = new Set(["node_modules", ".git", ".turbo", "dist", "coverage", ".claude"]);
const TEXT = /\.(ts|tsx|mts|js|mjs|json|toml|yml|yaml|md|sql|example)$/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED_DIRS.has(entry.name) ? [] : files(join(dir, entry.name));
    }
    return TEXT.test(entry.name) || entry.name === ".env.example" ? [join(dir, entry.name)] : [];
  });
}

const rel = (file: string) => relative(REPO_ROOT, file).split("\\").join("/");
const ALL = files(REPO_ROOT).filter((file) => !rel(file).startsWith(".env"));
const read = (file: string) => readFileSync(file, "utf8");
const holding = (needle: RegExp | string) =>
  ALL.filter((file) => {
    const text = read(file);
    return typeof needle === "string" ? text.includes(needle) : needle.test(text);
  })
    .map(rel)
    .sort();

const KEY_NAME = ["API", "AUTH", "ADMIN", "KEY"].join("_");
const ADMIN_PATH = /\/auth\/v1\/admin|\/admin\/users/;
const OPAQUE_KEY = new RegExp(["sb", "secret", ""].join("_"));
const JWT_SHAPED = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

describe("identity admin credential confinement (ADR-0019)", () => {
  it("the variable name appears only in the composition config, the shell, its tests and docs", () => {
    const allowed = new Set([
      "packages/api/src/composition/config.ts",
      "supabase/functions/api/index.ts",
      "supabase/functions/.env.example",
      "packages/api/test/env.test.ts",
      "packages/api/test/deno-shell.test.ts",
      "packages/api/test/harness.ts",
      "packages/api/test/identity-admin-boundary.test.ts",
    ]);
    const outside = holding(KEY_NAME).filter(
      (file) => !allowed.has(file) && !file.startsWith("docs/") && !/^[^/]+\.md$/.test(file),
    );
    expect(outside).toEqual([]);
    // The scan sees the places it is allowed in, so an empty result is not a broken walker.
    expect(holding(KEY_NAME)).toContain("packages/api/src/composition/config.ts");
  });

  it("the name is absent from the web app and from every inner package", () => {
    const leaks = holding(KEY_NAME).filter((file) =>
      /^(apps\/web|packages\/(app|engine|db|storage|push))\//.test(file),
    );
    expect(leaks).toEqual([]);
  });

  it("the GoTrue admin path is built in the adapter only (plus the local dev seed script and docs)", () => {
    const allowed = new Set([
      "packages/api/src/adapters/gotrue-identity-admin.ts",
      "packages/api/test/gotrue-identity-admin.test.ts",
      "packages/api/test/identity-admin-boundary.test.ts",
      // Local-only seeding of dev accounts against the local stack; not a runtime path.
      "packages/db/scripts/dev-seed/accounts.ts",
    ]);
    const outside = holding(ADMIN_PATH).filter(
      (file) => !allowed.has(file) && !file.startsWith("docs/"),
    );
    expect(outside).toEqual([]);
    expect(holding(ADMIN_PATH)).toContain("packages/api/src/adapters/gotrue-identity-admin.ts");
  });

  it("no opaque secret key or JWT-shaped literal is committed", () => {
    // The tests that assert on these shapes hold the needle as a pattern, not as a credential.
    const exempt = new Set(["packages/api/test/deno-shell.test.ts"]);
    expect(holding(OPAQUE_KEY).filter((file) => !exempt.has(file))).toEqual([]);
    expect(holding(JWT_SHAPED)).toEqual([]);
  });

  it("the walker finds the repository sources", () => {
    expect(ALL.map(rel)).toContain("packages/api/src/composition/config.ts");
    expect(ALL.length).toBeGreaterThan(200);
  });
});

describe("rate-limit key confinement (ADR-0020)", () => {
  const RATE_KEY_NAME = ["API", "RATE", "LIMIT", "KEY"].join("_");

  it("the variable name appears only in the composition config, its tests and docs", () => {
    const allowed = new Set([
      "packages/api/src/composition/config.ts",
      "supabase/functions/.env.example",
      "packages/api/test/env.test.ts",
      "packages/api/test/deno-shell.test.ts",
      "packages/api/test/network-key.test.ts",
    ]);
    const outside = holding(RATE_KEY_NAME).filter(
      (file) => !allowed.has(file) && !file.startsWith("docs/") && !/^[^/]+\.md$/.test(file),
    );
    expect(outside).toEqual([]);
    expect(holding(RATE_KEY_NAME)).toContain("packages/api/src/composition/config.ts");
  });

  it("the name is absent from the web app and from every inner package", () => {
    const leaks = holding(RATE_KEY_NAME).filter((file) =>
      /^(apps\/web|packages\/(app|engine|db|storage|push))\//.test(file),
    );
    expect(leaks).toEqual([]);
  });
});

describe("no error carries the key", () => {
  const KEY = ["sb", "secret", "guard-fixture-not-a-key"].join("_");
  const ID = userId("0190a000-0000-7000-8000-000000000001");

  async function failureOf(fetch: typeof globalThis.fetch): Promise<Error> {
    const admin = createGoTrueIdentityAdmin({
      authUrl: "http://gotrue.invalid/auth/v1",
      adminKey: KEY,
      fetch,
    });
    try {
      await admin.deleteUser(ID);
    } catch (error) {
      return error as Error;
    }
    throw new Error("expected the deletion to fail");
  }

  it("adapter errors say only unavailable or rejected, whatever the upstream answers", async () => {
    const echoing = (status: number) => async () =>
      new Response(`denied for ${KEY} at http://gotrue.invalid/auth/v1/admin/users/${ID}`, {
        status,
      });
    const failures = [
      await failureOf(echoing(401)),
      await failureOf(echoing(500)),
      await failureOf(async () => {
        throw new Error(`connect failed with ${KEY}`);
      }),
    ];
    expect(failures.map((error) => error.message)).toEqual([
      "rejected",
      "unavailable",
      "unavailable",
    ]);
    for (const error of failures) {
      expect(
        JSON.stringify({ ...error, message: error.message, stack: error.stack }),
      ).not.toContain(KEY);
      expect(error.message).not.toContain(ID);
    }
  });

  it("env error descriptions name the variable and never the value", () => {
    const base = {
      SUPABASE_URL: "https://abc.supabase.co",
      API_STORAGE_S3_ENDPOINT: "http://kong:8000/storage/v1/s3",
      API_STORAGE_S3_REGION: "local",
      API_STORAGE_S3_ACCESS_KEY_ID: "s3-key-id-123",
      API_STORAGE_S3_SECRET_ACCESS_KEY: "s3-secret-123456789",
      API_STORAGE_BUCKET: "entry-photos",
    };
    const bad = `${KEY} with a space`;
    const result = loadApiEnv(
      (name) =>
        ({ ...base, [KEY_NAME]: bad, API_DATABASE_URL: undefined })[name as keyof typeof base],
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const message = describeEnvError(result.error);
    expect(message).toContain(KEY_NAME);
    expect(message).not.toContain(KEY);
    expect(JSON.stringify(result.error)).not.toContain(KEY);
  });
});
