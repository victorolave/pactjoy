import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";
import { bootstrapRoles } from "./bootstrap-roles.ts";
import { connect } from "./db.ts";
import { resolveTestDatabase } from "./db-source.ts";
import { createFreshDatabase, migrateWithClientDefaults } from "./migrate.ts";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/** Provides one migrated Postgres 17 database to the run; throws (never skips) without one. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const source = await resolveTestDatabase({
    env: process.env,
    startContainer: async () => {
      const container = await new PostgreSqlContainer("postgres:17").start();
      return { url: container.getConnectionUri(), stop: () => container.stop().then(() => {}) };
    },
  });
  let dropFresh = async () => {};
  const teardown = async () => {
    await dropFresh();
    await source.stop();
  };
  try {
    const fresh = source.fromEnv ? await createFreshDatabase(source.url) : undefined;
    dropFresh = fresh?.drop ?? dropFresh;
    const sql = connect(source.url);
    await bootstrapRoles(sql).finally(() => sql.end());
    const url = fresh?.url ?? source.url;
    await migrateWithClientDefaults(url);
    project.provide("databaseUrl", url);
  } catch (error) {
    await teardown();
    throw error;
  }
  return teardown;
}
