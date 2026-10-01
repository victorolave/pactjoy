import { createTestApp } from "../testing/app-harness.ts";
import {
  describeCircleGuardContract,
  describeSeasonGuardContract,
} from "./guard-version.contract.ts";

const inMemory = async () => ({ uow: createTestApp().uow });

describeCircleGuardContract("in-memory", inMemory);
describeSeasonGuardContract("in-memory", inMemory);
