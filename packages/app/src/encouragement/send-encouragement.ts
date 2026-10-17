import type { MemberId } from "@pactjoy/engine";
import {
  type FeedDeps,
  feedContextOf,
  guardSocialWrite,
  loadFeedWorld,
} from "../feed/feed-context.ts";
import type { IdGenerator } from "../ports/id-generator.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { UnitOfWork } from "../ports/unit-of-work.ts";
import { isReactionEmoji } from "../reaction/feed-reaction.ts";
import type { Actor } from "../shared/actor.ts";
import { encouragementId, type SeasonId } from "../shared/ids.ts";
import { err, ok, type Result } from "../shared/result.ts";
import { loadNudgeActor, type NudgeActorError } from "./nudge-actor.ts";
import { loadNudgeCase } from "./nudge-for-viewer.ts";

export interface SendEncouragementDeps extends FeedDeps {
  readonly uow: UnitOfWork<Repositories>;
  readonly ids: IdGenerator;
}

export interface SendEncouragementInput {
  readonly seasonId: SeasonId;
  readonly recipientId: MemberId;
  /** The recipient's hard week, 1-based, as the suggestion named it. */
  readonly week: number;
  /** One of the four codes. `string` on purpose: it may come from an arbitrary JSON body. */
  readonly emoji: string;
}

export interface SendEncouragementResult {
  readonly recipientId: MemberId;
  readonly week: number;
}

export type SendEncouragementError =
  | NudgeActorError
  | { readonly kind: "InvalidReaction" }
  /** The case is not the viewer's live suggestion (not hard, not final, dismissed, themself, left, closed season). */
  | { readonly kind: "NudgeNotAvailable" }
  | { readonly kind: "EncouragementAlreadySent" };

/**
 * Sends an encouragement answering the viewer's live suggestion (ADR-0018, F13, F14; REQ-N5, N6).
 * One transaction: the case is recomputed here from the stores it writes to, so an encouragement
 * can only exist for a case that is the sender's current suggestion at that moment (a hard,
 * final, latest week of a member still in the circle, not dismissed, with no earlier send that
 * day). `sentOn` is the day in the season's time zone.
 *
 * A second send for the same case is `EncouragementAlreadySent`; two racing sends end at the unique
 * keys as one row and a `ConcurrencyConflict` for the loser. Nothing about points, standings or
 * consistency changes. Delivering a push is job D's business: see `encouragementNotice`.
 */
export async function sendEncouragement(
  deps: SendEncouragementDeps,
  actor: Actor,
  input: SendEncouragementInput,
): Promise<Result<SendEncouragementResult, SendEncouragementError>> {
  const { emoji } = input;
  if (!isReactionEmoji(emoji)) return err({ kind: "InvalidReaction" });

  return deps.uow.transaction(
    async (repos): Promise<Result<SendEncouragementResult, SendEncouragementError>> => {
      const resolved = await loadNudgeActor(repos, actor, input.seasonId);
      if (!resolved.ok) return resolved;
      const { season, circle, viewer } = resolved.value;

      const sent = await repos.encouragements.listSent(season.id, viewer.id);
      if (sent.some((e) => e.recipientId === input.recipientId && e.caseWeek === input.week)) {
        return err({ kind: "EncouragementAlreadySent" });
      }

      // The refusal above writes nothing, so like a `recordEntry` replay it is not guarded. From
      // here the send is, before the case is recomputed: a concurrent leave or season close fails
      // it with `ConcurrencyConflict`, and a concurrent send or dismissal of the same case is
      // serialized, so the case below is read after the other one's rows are visible.
      await guardSocialWrite(repos, circle, season);

      const now = deps.clock.now();
      const context = await feedContextOf(deps, repos, circle, now);
      if (!context || context.season.id !== season.id) return err({ kind: "NudgeNotAvailable" });
      const world = await loadFeedWorld(deps, repos, context);
      const live = await loadNudgeCase(repos, context, world, viewer);
      if (live === null || live.targetId !== input.recipientId || live.week !== input.week) {
        return err({ kind: "NudgeNotAvailable" });
      }

      await repos.encouragements.add({
        id: encouragementId(deps.ids.next()),
        seasonId: season.id,
        senderId: viewer.id,
        recipientId: input.recipientId,
        caseWeek: input.week,
        emoji,
        sentAt: now,
        sentOn: context.todayDate,
      });
      return ok({ recipientId: input.recipientId, week: input.week });
    },
  );
}
