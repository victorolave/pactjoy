import { uuid } from "./formats.ts";
import { array, object, string } from "./schema.ts";

/** A generous bound: a member holds a handful of Commitments, the app checks coverage exactly. */
const MAX_DECISIONS = 32;

/**
 * Structure only: which values are decisions, and that they cover the member's commitments exactly,
 * is the app's call (`InvalidClosureDecision`, `ClosureIncomplete`). The member and the season come
 * from the token and the path, never the body.
 */
export const submitClosureBody = object({
  decisions: array(object({ commitmentId: uuid, decision: string }), MAX_DECISIONS),
});
