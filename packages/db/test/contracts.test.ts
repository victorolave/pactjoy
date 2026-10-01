import {
  describeCircleRepositoryContract,
  describeHabitRepositoryContract,
  describeUnitOfWorkContract,
} from "@pactjoy/app/contracts";
import { afterAll } from "vitest";
import { createClient } from "../src/client.ts";
import { bindRepositories } from "../src/repositories.ts";
import { createUnitOfWork } from "../src/unit-of-work.ts";
import { connect, databaseUrl, truncateAll } from "./db.ts";

// One pool for the whole file, with >= 2 connections: the contracts hold a
// transaction open while another one runs (ContractSubject docblock).
const client = createClient({ url: databaseUrl(), max: 4 });
const admin = connect(databaseUrl());
afterAll(async () => {
  await client.end();
  await admin.end();
});

/** A fresh, EMPTY store for each test: the files run serially (design section 5). */
async function postgres() {
  await truncateAll(admin);
  return { uow: createUnitOfWork(client.begin, bindRepositories) };
}

describeCircleRepositoryContract("postgres", postgres);
describeHabitRepositoryContract("postgres", postgres);
describeUnitOfWorkContract("postgres", postgres);
