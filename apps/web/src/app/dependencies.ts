import type { QueryClient } from "@tanstack/react-query";
import type { SessionEvents } from "../features/auth/session-events.ts";
import type { SessionManager } from "../features/auth/session-manager.ts";
import type { AuthPort } from "../ports/auth.ts";
import type { PactJoyApi } from "../ports/pactjoy-api.ts";
import type { TokenStore } from "../ports/token-store.ts";

/** Everything the composition root wires: ports implemented by adapters (or by fakes in tests). */
export interface AppDependencies {
  readonly auth: AuthPort;
  readonly api: PactJoyApi;
  readonly store: TokenStore;
  readonly sessions: SessionManager;
  /** The API adapter's `onUnauthorized` calls `sessionEvents.expire`. */
  readonly sessionEvents: SessionEvents;
  readonly queryClient: QueryClient;
}
