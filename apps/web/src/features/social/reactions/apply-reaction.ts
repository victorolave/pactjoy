import type { ReactionCode, ReactionsDto } from "../../../ports/wire.ts";

/**
 * What the chips of one item look like once the viewer's reaction is `code` (`null` takes it
 * back): the previous one stops counting, the new one counts, everybody else's stay. This is only
 * the optimistic picture; the server's answer replaces it, so nothing here is ever scoring.
 */
export function applyReaction(reactions: ReactionsDto, code: ReactionCode | null): ReactionsDto {
  const counts = { ...reactions.counts };
  if (reactions.mine !== null) counts[reactions.mine] -= 1;
  if (code !== null) counts[code] += 1;
  return { ...reactions, counts, mine: code };
}
