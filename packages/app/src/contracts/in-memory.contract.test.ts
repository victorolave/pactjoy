import { createTestApp } from "../testing/app-harness.ts";
import { describeCircleRepositoryContract } from "./circle.contract.ts";
import {
  describeCircleGuardContract,
  describeSeasonGuardContract,
} from "./guard-version.contract.ts";
import { describeHabitRepositoryContract } from "./habit.contract.ts";
import { describeSeasonRepositoryContract } from "./season.contract.ts";
import { describeUnitOfWorkContract } from "./unit-of-work.contract.ts";

const inMemory = async () => ({ uow: createTestApp().uow });

describeCircleRepositoryContract("in-memory", inMemory);
describeCircleGuardContract("in-memory", inMemory);
describeSeasonGuardContract("in-memory", inMemory);
describeHabitRepositoryContract("in-memory", inMemory);
describeSeasonRepositoryContract("in-memory", inMemory);
describeUnitOfWorkContract("in-memory", inMemory);
