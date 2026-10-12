/**
 * The public API of the review feature (change periodic-review, ADR-0014): the full-screen flow
 * the `/review/:seasonId/:periodIndex` route mounts, and the entry points other screens place:
 * the Today card, the baseline offer on the pact-closed screen, the Temporada notice and the
 * owner's stage badge. Everything else under `features/review` is internal, and the feature
 * imports no other feature: it reads Today through the API port and the shared query keys.
 */
export { BaselineOffer } from "./entry/BaselineOffer.tsx";
export { ReviewNotice } from "./entry/ReviewNotice.tsx";
export { ReviewTodayCard } from "./entry/ReviewTodayCard.tsx";
export { ReviewFlowScreen } from "./flow/ReviewFlowScreen.tsx";
export { HabitStageBadge } from "./stage/HabitStageBadge.tsx";
