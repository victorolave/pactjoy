import { createContext, useContext } from "react";

export interface TodayDates {
  /** The server's "today" when the screen's data was loaded. */
  readonly today: string;
  /** The day the rows describe: today, or the season's last day once it has ended. */
  readonly refDate: string;
}

/**
 * Rows tell an entry of yesterday from today's with `today`; recording sends `refDate` as the
 * entry's day, so a tap lands on the day the user SAW even if midnight passed since the load.
 */
export const TodayDateContext = createContext<TodayDates | undefined>(undefined);

export const useTodayDates = (): TodayDates | undefined => useContext(TodayDateContext);
export const useTodayDate = (): string | undefined => useTodayDates()?.today;
