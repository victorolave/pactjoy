import { describe, expect, it, vi } from "vitest";
import { resolveTestDatabase } from "./db-source.ts";

const PROVIDED = "postgres://user:s3cret@db.example.test:5432/ci";
const CONTAINER = "postgres://test:test@localhost:49152/test";

const container = () => ({ url: CONTAINER, stop: vi.fn(async () => {}) });

describe("resolveTestDatabase", () => {
  it("HM-S1: uses TEST_DATABASE_URL and starts no container", async () => {
    const startContainer = vi.fn(async () => container());
    const probe = vi.fn(async () => {});

    const db = await resolveTestDatabase({
      env: { TEST_DATABASE_URL: PROVIDED },
      startContainer,
      probe,
    });

    expect(db).toMatchObject({ url: PROVIDED, fromEnv: true });
    expect(startContainer).not.toHaveBeenCalled();
    expect(probe).toHaveBeenCalledWith(PROVIDED);
  });

  it("HM-S2: starts a container when TEST_DATABASE_URL is unset or blank", async () => {
    for (const env of [{}, { TEST_DATABASE_URL: "  " }]) {
      const started = container();

      const db = await resolveTestDatabase({ env, startContainer: async () => started });

      expect(db).toMatchObject({ url: CONTAINER, fromEnv: false });
      await db.stop();
      expect(started.stop).toHaveBeenCalledOnce();
    }
  });

  it("HM-S4: rejects (never skips) when no container can be started", async () => {
    const startContainer = async () => {
      throw new Error("Could not find a working container runtime strategy");
    };

    await expect(resolveTestDatabase({ env: {}, startContainer })).rejects.toThrow(
      "packages/db tests need Postgres: start Docker or set TEST_DATABASE_URL",
    );
  });

  it("HM-S5: an unreachable URL fails naming the host and never the credentials", async () => {
    const probe = async () => {
      throw new Error(`connect ECONNREFUSED for ${PROVIDED}`);
    };

    const error = await resolveTestDatabase({
      env: { TEST_DATABASE_URL: PROVIDED },
      startContainer: async () => container(),
      probe,
    }).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("db.example.test");
    expect((error as Error).message).not.toMatch(/s3cret|user:/);
  });

  it("HM-S5: an unreachable URL also reports the error code, for diagnosis", async () => {
    const cases = [
      { code: "ECONNREFUSED", expected: "ECONNREFUSED" },
      { code: "28P01", expected: "28P01" },
    ];
    for (const { code, expected } of cases) {
      const probe = async () => {
        throw Object.assign(new Error(`failed for ${PROVIDED}`), { code });
      };

      const error = await resolveTestDatabase({
        env: { TEST_DATABASE_URL: PROVIDED },
        startContainer: async () => container(),
        probe,
      }).catch((e: Error) => e);

      expect((error as Error).message).toContain(expected);
      expect((error as Error).message).not.toMatch(/s3cret|user:/);
    }
  });
});
