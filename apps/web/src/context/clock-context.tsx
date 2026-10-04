import { createContext, type ReactNode, useContext } from "react";
import type { Clock } from "../ports/clock.ts";

const ClockContext = createContext<Clock | null>(null);

export function ClockProvider({
  clock,
  children,
}: {
  readonly clock: Clock;
  readonly children: ReactNode;
}) {
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

export function useClock(): Clock {
  const clock = useContext(ClockContext);
  if (clock === null) throw new Error("useClock must be used inside a ClockProvider");
  return clock;
}
