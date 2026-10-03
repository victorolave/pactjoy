import type { TodayView } from "@pactjoy/app";
import { QueryClient } from "@tanstack/react-query";
import { type RenderResult, render } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { AppDependencies } from "../app/dependencies.ts";
import { AppProviders } from "../app/providers.tsx";
import { AppRoutes } from "../app/routes.tsx";
import { createSessionEvents } from "../features/auth/session-events.ts";
import { SessionManager } from "../features/auth/session-manager.ts";
import type { ApiError } from "../ports/api-error.ts";
import { FakeAuth, fakeSession } from "./fake-auth.ts";
import { FakePactJoyApi } from "./fake-pactjoy-api.ts";
import { FixedClock } from "./fixed-clock.ts";
import { activeTodayFixture } from "./fixtures/today.ts";
import { MemoryTokenStore } from "./memory-token-store.ts";
import { SequentialIds } from "./sequential-ids.ts";

export interface RenderAppOptions {
  readonly path?: string;
  /** Start with a stored session. Defaults to true. */
  readonly signedIn?: boolean;
  /** What `getToday` answers. Defaults to an active season. */
  readonly today?: TodayView;
  /** `getToday` rejects with these, one per call, before it answers `today`. */
  readonly todayFailures?: readonly ApiError[];
}

export interface RenderedApp extends RenderResult {
  readonly deps: AppDependencies & {
    readonly auth: FakeAuth;
    readonly api: FakePactJoyApi;
    readonly store: MemoryTokenStore;
  };
}

/** The whole route tree over fakes, at a given path. */
export function renderApp({
  path = "/",
  signedIn = true,
  today = activeTodayFixture(),
  todayFailures = [],
}: RenderAppOptions = {}): RenderedApp {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(signedIn ? fakeSession() : null);
  const api = new FakePactJoyApi(today);
  for (const failure of todayFailures) api.failNext("getToday", failure);
  const deps = {
    auth,
    api,
    ids: new SequentialIds(),
    store,
    sessions: new SessionManager(auth, store, new FixedClock(0)),
    sessionEvents: createSessionEvents(),
    queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  };
  const result = render(
    <AppProviders deps={deps}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
  return Object.assign(result, { deps });
}
