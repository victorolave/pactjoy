import { createContext, type ReactNode, useContext } from "react";
import type { ReminderNamesPort } from "../ports/reminder-names.ts";

const ReminderNamesContext = createContext<ReminderNamesPort | null>(null);

export function ReminderNamesProvider({
  reminderNames,
  children,
}: {
  readonly reminderNames: ReminderNamesPort;
  readonly children: ReactNode;
}) {
  return (
    <ReminderNamesContext.Provider value={reminderNames}>{children}</ReminderNamesContext.Provider>
  );
}

export function useReminderNames(): ReminderNamesPort {
  const names = useContext(ReminderNamesContext);
  if (names === null) {
    throw new Error("useReminderNames must be used inside a ReminderNamesProvider");
  }
  return names;
}
