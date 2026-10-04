import { createContext, type ReactNode, useContext } from "react";
import type { IdSource } from "../ports/ids.ts";

const IdsContext = createContext<IdSource | null>(null);

export function IdsProvider({
  ids,
  children,
}: {
  readonly ids: IdSource;
  readonly children: ReactNode;
}) {
  return <IdsContext.Provider value={ids}>{children}</IdsContext.Provider>;
}

export function useIds(): IdSource {
  const ids = useContext(IdsContext);
  if (ids === null) throw new Error("useIds must be used inside an IdsProvider");
  return ids;
}
