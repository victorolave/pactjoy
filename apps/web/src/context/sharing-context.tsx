import { createContext, type ReactNode, useContext } from "react";
import type { Sharing } from "../ports/sharing.ts";

const SharingContext = createContext<Sharing | null>(null);

export function SharingProvider({
  sharing,
  children,
}: {
  readonly sharing: Sharing;
  readonly children: ReactNode;
}) {
  return <SharingContext.Provider value={sharing}>{children}</SharingContext.Provider>;
}

export function useSharing(): Sharing {
  const sharing = useContext(SharingContext);
  if (sharing === null) throw new Error("useSharing must be used inside a SharingProvider");
  return sharing;
}
