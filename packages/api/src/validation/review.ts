import { uuid } from "./formats.ts";
import { array, nullable, number, object, string } from "./schema.ts";

/** A generous bound: a member holds a handful of Commitments, the app checks coverage exactly. */
const MAX_ANSWERS = 32;

/** The four SRBAI slots of one Commitment. Structure only: the app owns the 1..7 range and the shape per mode. */
const answer = object({
  commitmentId: uuid,
  items: array(nullable(number), 4),
});

// Both reflection fields are required (`null` is "nothing written"), so nothing is silently
// defaulted. The member and the season come from the token and the path, never the body.
export const submitReviewBody = object({
  reflection: object({ helped: nullable(string), hard: nullable(string) }),
  automaticity: array(answer, MAX_ANSWERS),
});
