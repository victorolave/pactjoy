import { createContext, type ReactNode, useContext } from "react";
import type { Haptics } from "../ports/haptics.ts";

const HapticsContext = createContext<Haptics | null>(null);

export function HapticsProvider({
  haptics,
  children,
}: {
  readonly haptics: Haptics;
  readonly children: ReactNode;
}) {
  return <HapticsContext.Provider value={haptics}>{children}</HapticsContext.Provider>;
}

export function useHaptics(): Haptics {
  const haptics = useContext(HapticsContext);
  if (haptics === null) throw new Error("useHaptics must be used inside a HapticsProvider");
  return haptics;
}
