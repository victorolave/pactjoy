import { createTestApp } from "../testing/app-harness.ts";
import { createInMemoryReviewRepository } from "../testing/in-memory-review-repository.ts";
import { createInMemorySeasonClosureRepository } from "../testing/in-memory-season-closure-repository.ts";
import { describeCircleRepositoryContract } from "./circle.contract.ts";
import { describeEntryRepositoryContract } from "./entry.contract.ts";
import {
  describeCircleGuardContract,
  describeSeasonGuardContract,
} from "./guard-version.contract.ts";
import { describeHabitRepositoryContract } from "./habit.contract.ts";
import { describePauseRequestRepositoryContract } from "./pause.contract.ts";
import { describeReviewRepositoryContract } from "./review.contract.ts";
import { describeSeasonRepositoryContract } from "./season.contract.ts";
import { describeSeasonClosureRepositoryContract } from "./season-closure.contract.ts";
import { describeUnitOfWorkContract } from "./unit-of-work.contract.ts";

const inMemory = async () => ({ uow: createTestApp().uow });

describeCircleRepositoryContract("in-memory", inMemory);
describeCircleGuardContract("in-memory", inMemory);
describeSeasonGuardContract("in-memory", inMemory);
describeEntryRepositoryContract("in-memory", inMemory);
describeHabitRepositoryContract("in-memory", inMemory);
describeSeasonRepositoryContract("in-memory", inMemory);
describePauseRequestRepositoryContract("in-memory", inMemory);
describeReviewRepositoryContract("in-memory", async () => ({
  repository: createInMemoryReviewRepository(),
}));
describeSeasonClosureRepositoryContract("in-memory", async () => ({
  repository: createInMemorySeasonClosureRepository(),
}));
describeUnitOfWorkContract("in-memory", inMemory);
