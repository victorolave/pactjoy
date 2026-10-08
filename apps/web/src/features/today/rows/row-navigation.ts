import { createContext } from "react";

/** Optional so isolated row renderers stay usable without the running Today screen. */
export const TodayRowSeasonContext = createContext<string | null>(null);
