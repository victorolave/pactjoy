import type { RandomSource } from "../ports/random-source.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import type { Actor } from "../shared/actor.ts";
import { InviteCodeGenerationFailed } from "../shared/errors.ts";
import type { CircleId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import type { Clock } from "../time/clock.port.ts";
import type { Instant } from "../time/instant.ts";
import { type Circle, findActiveMember, type Invite } from "./circle.ts";
import { generateInviteCode, type InviteCode, inviteCodeExpiresAt } from "./invite-code.ts";

/** Retry budget for `generateUniqueInviteCode` before giving up (extremely unlikely to be exhausted: 31^6 codes). */
const MAX_GENERATION_ATTEMPTS = 5;

/**
 * Draws a fresh {@link InviteCode}, retrying if it collides with another
 * circle's currently active (unexpired) invite -- collisions across a 31^6
 * code space are astronomically unlikely, but not impossible, and two
 * circles must never resolve to the same active code. A circle's own prior
 * code (about to be replaced) is not a collision. After
 * {@link MAX_GENERATION_ATTEMPTS} straight collisions, throws
 * {@link InviteCodeGenerationFailed} (ADR-0008, D3: infra failure, not a
 * domain `Result` error).
 */
async function generateUniqueInviteCode(
  repos: Repositories,
  random: RandomSource,
  now: Instant,
  ownCircleId: CircleId,
): Promise<InviteCode> {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const code = generateInviteCode(random);
    const collision = await repos.circles.findByInviteCode(code);
    const isActiveCollisionWithAnotherCircle =
      collision !== null &&
      collision.id !== ownCircleId &&
      collision.invite !== null &&
      collision.invite.expiresAt > now;
    if (!isActiveCollisionWithAnotherCircle) {
      return code;
    }
  }
  throw new InviteCodeGenerationFailed();
}

export interface GenerateInviteDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly random: RandomSource;
  readonly clock: Clock;
}

export interface GenerateInviteInput {
  readonly circleId: CircleId;
}

export type GenerateInviteError =
  | { readonly kind: "CircleNotFound" }
  | { readonly kind: "NotAMember" };

/**
 * Generates a fresh invite code for a circle (CM-3). Any active member may
 * do it -- no admin role (A1, A4) -- including in a solo circle (B4,
 * CM-16). A circle holds at most one invite at a time, so regenerating
 * (calling this again) replaces and invalidates the previous code (CM-5):
 * see `circle.ts`'s `Invite` docstring.
 */
export async function generateInvite(
  deps: GenerateInviteDeps,
  actor: Actor,
  input: GenerateInviteInput,
): Promise<Result<Invite, GenerateInviteError>> {
  return deps.uow.transaction(async (repos): Promise<Result<Invite, GenerateInviteError>> => {
    const circle = await repos.circles.get(input.circleId);
    if (!circle) {
      return err({ kind: "CircleNotFound" });
    }
    const member = findActiveMember(circle, actor.userId);
    if (!member) {
      return err({ kind: "NotAMember" });
    }

    const now = deps.clock.now();
    const invite: Invite = {
      code: await generateUniqueInviteCode(repos, deps.random, now, circle.id),
      createdAt: now,
      expiresAt: inviteCodeExpiresAt(now),
      createdBy: member.id,
    };
    const updated: Circle = { ...circle, invite, version: circle.version + 1 };
    await repos.circles.save(updated, circle.version);
    return ok(invite);
  });
}
