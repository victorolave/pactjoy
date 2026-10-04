import type { TodayView } from "@pactjoy/app";
import { act, type RenderResult, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, useLocation, useNavigate } from "react-router";
import { LocalStorageDeviceStore } from "../adapters/local-storage-device-store.ts";
import { createTodayPersister } from "../adapters/query-persister.ts";
import type { AppDependencies } from "../composition/dependencies.ts";
import { AppProviders } from "../composition/providers.tsx";
import { createQueryClient } from "../composition/query-client.ts";
import { createSessionEvents, SessionManager } from "../features/auth/index.ts";
import type { ApiError } from "../ports/api-error.ts";
import { AppRoutes } from "../shell/routes.tsx";
import { FakeAuth, fakeSession } from "./fake-auth.ts";
import { FakeConnectivity } from "./fake-connectivity.ts";
import { FakeHaptics } from "./fake-haptics.ts";
import { FakePactJoyApi } from "./fake-pactjoy-api.ts";
import { FakeSharing } from "./fake-sharing.ts";
import { FixedClock } from "./fixed-clock.ts";
import { activeTodayFixture } from "./fixtures/today.ts";
import { MemoryStorage } from "./memory-storage.ts";
import { MemoryTokenStore } from "./memory-token-store.ts";
import { SequentialIds } from "./sequential-ids.ts";

export interface RenderAppOptions {
  readonly path?: string;
  /** Start with a stored session. Defaults to true. */
  readonly signedIn?: boolean;
  /** What `getToday` answers. Defaults to an active season. */
  readonly today?: TodayView;
  /** Where the saved Today lives. A fresh in-memory one by default, so tests never share it. */
  readonly storage?: Storage;
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
    readonly haptics: FakeHaptics;
    readonly store: MemoryTokenStore;
    readonly device: LocalStorageDeviceStore;
    readonly sharing: FakeSharing;
  };
}

function createFakeDeps({
  signedIn = true,
  today = activeTodayFixture(),
  todayFailures = [],
  online = true,
  storage = new MemoryStorage(),
}: RenderAppOptions = {}): RenderedApp["deps"] {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(signedIn ? fakeSession() : null);
  const api = new FakePactJoyApi(today);
  for (const failure of todayFailures) api.failNext("getToday", failure);
  return {
    auth,
    api,
    ids: new SequentialIds(),
    haptics: new FakeHaptics(),
    connectivity: new FakeConnectivity(online),
    store,
    device: new LocalStorageDeviceStore(new MemoryStorage()),
    sharing: new FakeSharing(),
    sessions: new SessionManager(auth, store, new FixedClock(0)),
    sessionEvents: createSessionEvents(),
    queryClient: createQueryClient({ retryQueries: false }),
    persister: createTodayPersister(storage, { throttleMs: 0 }),
  };
}

/** The whole route tree over fakes, at a given path. */
export function renderApp({ path = "/", ...options }: RenderAppOptions = {}): RenderedApp {
  const deps = createFakeDeps(options);
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

/** One component over the same fakes and providers, with no route tree around it. */
export function renderInProviders(
  ui: ReactNode,
  options: RenderAppOptions = {},
): RenderResult & { readonly deps: RenderedApp["deps"] } {
  const deps = createFakeDeps(options);
  const result = render(
    <AppProviders deps={deps}>
      <MemoryRouter initialEntries={[options.path ?? "/"]}>{ui}</MemoryRouter>
    </AppProviders>,
  );
  return Object.assign(result, { deps });
}
