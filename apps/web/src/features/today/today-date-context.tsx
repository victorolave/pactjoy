import { createContext, useContext } from "react";

/** The server's "today" for the screen on display, so rows can tell an entry of yesterday. */
export const TodayDateContext = createContext<string | undefined>(undefined);

export const useTodayDate = (): string | undefined => useContext(TodayDateContext);
