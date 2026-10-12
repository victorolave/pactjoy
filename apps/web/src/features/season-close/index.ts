/**
 * The public API of the season-close feature (change season-close-graduation, ADR-0015): the
 * entry points other screens place and the screens the shell mounts. Everything else under
 * `features/season-close` is internal. It reads Today, the circle and the habits through the API
 * port and the shared query keys, so it imports no feature but `review` (the closing review
 * comes before the decisions).
 */
export { SeasonCloseTodayCard } from "./entry/SeasonCloseTodayCard.tsx";
