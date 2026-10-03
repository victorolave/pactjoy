import type { TodayView } from "@pactjoy/app";
import { act, type RenderResult, render } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import type { AppDependencies } from "../app/dependencies.ts";
import { AppProviders } from "../app/providers.tsx";
import { createQueryClient } from "../app/query-client.ts";
import { AppRoutes } from "../app/routes.tsx";
import { createSessionEvents } from "../features/auth/session-events.ts";
import { SessionManager } from "../features/auth/session-manager.ts";
import type { ApiError } from "../ports/api-error.ts";
import { FakeAuth, fakeSession } from "./fake-auth.ts";
import { FakeConnectivity } from "./fake-connectivity.ts";
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
  /** Whether the network is reachable. Defaults to true. */
  readonly online?: boolean;
  /** `getToday` rejects with these, one per call, before it answers `today`. */
  readonly todayFailures?: readonly ApiError[];
}

/** Lets a test read the URL and press the browser's Back button. */
function NavigationProbe({ onReady }: { readonly onReady: (back: () => void) => void }) {
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  onReady(() => navigate(-1));
  return <span hidden data-testid="location">{`${pathname}${search}`}</span>;
}

export interface RenderedApp extends RenderResult {
  /** The browser's Back button. */
  back(): void;
  /** Path and query of the current URL. */
  location(): string;
  readonly deps: AppDependencies & {
    readonly auth: FakeAuth;
    readonly api: FakePactJoyApi;
    readonly connectivity: FakeConnectivity;
    readonly store: MemoryTokenStore;
  };
}

/** The whole route tree over fakes, at a given path. */
export function renderApp({
  path = "/",
  signedIn = true,
  today = activeTodayFixture(),
  todayFailures = [],
  online = true,
}: RenderAppOptions = {}): RenderedApp {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(signedIn ? fakeSession() : null);
  const api = new FakePactJoyApi(today);
  for (const failure of todayFailures) api.failNext("getToday", failure);
  const deps = {
    auth,
    api,
    ids: new SequentialIds(),
    connectivity: new FakeConnectivity(online),
    store,
    sessions: new SessionManager(auth, store, new FixedClock(0)),
    sessionEvents: createSessionEvents(),
    queryClient: createQueryClient({ retryQueries: false }),
  };
  let goBack = () => {};
  const result = render(
    <AppProviders deps={deps}>
      <MemoryRouter initialEntries={[path]}>
        <NavigationProbe onReady={(back) => (goBack = back)} />
        <AppRoutes />
      </MemoryRouter>
    </AppProviders>,
  );
  return Object.assign(result, {
    deps,
    back: () => act(() => goBack()),
    location: () => result.getByTestId("location").textContent ?? "",
  });
}
