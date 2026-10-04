/**
 * The public API of the circle feature: the viewer's circle, the invite preview, the cache
 * invalidation every circle mutation runs and the Spanish copy for circle failures. Everything else
 * under `features/circle` is internal, and other features never import it.
 */
export { type CircleFailure, type CircleField, circleFailure } from "./circle-messages.ts";
export { invalidateCircleState, useInvitePreview, useMyCircle } from "./queries.ts";
