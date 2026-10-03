import { createContext, type ReactNode, useContext } from "react";
import type { PactJoyApi } from "../ports/pactjoy-api.ts";

const ApiContext = createContext<PactJoyApi | null>(null);

export function ApiProvider({
  api,
  children,
}: {
  readonly api: PactJoyApi;
  readonly children: ReactNode;
}) {
  return <ApiContext.Provider value={api}>{children}</ApiContext.Provider>;
}

/** Screens reach the backend only through this port, never through fetch. */
export function usePactJoyApi(): PactJoyApi {
  const api = useContext(ApiContext);
  if (api === null) throw new Error("usePactJoyApi must be used inside an ApiProvider");
  return api;
}
