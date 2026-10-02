/**
 * Input builders for `createCircle` / `joinCircle` in tests. Call sites go
 * through these so a change to the inputs touches one place, not every test.
 */

import type { CreateCircleInput } from "../circle/create-circle.ts";
import type { JoinCircleInput } from "../circle/join-circle.ts";

export function createCircleInput(name: string): CreateCircleInput {
  return { name };
}

export function joinCircleInput(inviteCode: string): JoinCircleInput {
  return { inviteCode };
}
