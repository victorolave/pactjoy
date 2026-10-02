/**
 * Input builders for `createCircle` / `joinCircle` in tests. Call sites go
 * through these so a change to the inputs touches one place, not every test.
 */

import type { CreateCircleInput } from "../circle/create-circle.ts";
import type { JoinCircleInput } from "../circle/join-circle.ts";

export function createCircleInput(name: string, displayName = "Creator"): CreateCircleInput {
  return { name, displayName };
}

export function joinCircleInput(inviteCode: string, displayName = "Joiner"): JoinCircleInput {
  return { inviteCode, displayName };
}
