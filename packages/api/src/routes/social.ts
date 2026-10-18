import {
  circleFeed,
  dismissNudge,
  memberId,
  reactToFeedItem,
  removeFeedReaction,
  seasonId,
  sendEncouragement,
} from "@pactjoy/app";
import {
  presentCircleFeed,
  presentDismissedNudge,
  presentReactions,
  presentSentEncouragement,
} from "../presenters/social.ts";
import { uuid } from "../validation/formats.ts";
import { object } from "../validation/schema.ts";
import {
  dismissNudgeBody,
  feedCursorParam,
  feedItemKeyParam,
  reactBody,
  sendEncouragementBody,
} from "../validation/social.ts";
import { type ApiDeps, type Route, toResult, validate } from "./support.ts";

const none = object({});
const cursorParams = object({ cursor: feedCursorParam });
const seasonParams = object({ seasonId: uuid });
const itemParams = object({ seasonId: uuid, itemKey: feedItemKeyParam });

/**
 * The social routes (ADR-0011 Q25, ADR-0018): the circle activity feed, one reaction per item and
 * the encouragement nudge. The member is always the token's user and no route carries a member id
 * as its subject, so nobody can read another member's reactions, sends or dismissals. The feed is
 * derived on every read (F1); the cursor travels in the path because the router has no query
 * string (F11). An item key contains `:`, so a client sends it percent-encoded (`%3A`); the router
 * decodes each path segment before it reaches the handler.
 */
export function socialRoutes(deps: ApiDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/me/feed",
      async handle(ctx) {
        const input = validate(ctx, { params: none, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(await circleFeed(deps, ctx.actor), 200, presentCircleFeed);
      },
    },
    {
      method: "GET",
      pattern: "/me/feed/after/:cursor",
      async handle(ctx) {
        const input = validate(ctx, { params: cursorParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await circleFeed(deps, ctx.actor, { cursor: input.params.cursor }),
          200,
          presentCircleFeed,
        );
      },
    },
    {
      method: "PUT",
      pattern: "/seasons/:seasonId/feed/:itemKey/reaction",
      async handle(ctx) {
        const input = validate(ctx, { params: itemParams, body: reactBody });
        if (!input.ok) return input.result;
        return toResult(
          await reactToFeedItem(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            itemKey: input.params.itemKey,
            emoji: input.body.emoji,
          }),
          200,
          presentReactions,
        );
      },
    },
    {
      method: "DELETE",
      pattern: "/seasons/:seasonId/feed/:itemKey/reaction",
      async handle(ctx) {
        const input = validate(ctx, { params: itemParams, body: none, emptyBody: "object" });
        if (!input.ok) return input.result;
        return toResult(
          await removeFeedReaction(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            itemKey: input.params.itemKey,
          }),
          200,
          presentReactions,
        );
      },
    },
    {
      method: "POST",
      pattern: "/seasons/:seasonId/encouragements",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: sendEncouragementBody });
        if (!input.ok) return input.result;
        return toResult(
          await sendEncouragement(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            recipientId: memberId(input.body.recipientId),
            week: input.body.week,
            emoji: input.body.emoji,
          }),
          201,
          presentSentEncouragement,
        );
      },
    },
    {
      method: "POST",
      pattern: "/seasons/:seasonId/nudge-dismissals",
      async handle(ctx) {
        const input = validate(ctx, { params: seasonParams, body: dismissNudgeBody });
        if (!input.ok) return input.result;
        return toResult(
          await dismissNudge(deps, ctx.actor, {
            seasonId: seasonId(input.params.seasonId),
            targetId: memberId(input.body.targetId),
            week: input.body.week,
          }),
          200,
          presentDismissedNudge,
        );
      },
    },
  ];
}
