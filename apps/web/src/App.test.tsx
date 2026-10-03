import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { createTodayPersister } from "./adapters/query-persister.ts";
import type { AppDependencies } from "./app/dependencies.ts";
import { createSessionEvents } from "./features/auth/session-events.ts";
import { SessionManager } from "./features/auth/session-manager.ts";
import { FakeAuth, fakeSession } from "./testing/fake-auth.ts";
import { FakeConnectivity } from "./testing/fake-connectivity.ts";
import { FakePactJoyApi } from "./testing/fake-pactjoy-api.ts";
import { FixedClock } from "./testing/fixed-clock.ts";
import { noCircleTodayFixture } from "./testing/fixtures/today.ts";
import { MemoryStorage } from "./testing/memory-storage.ts";
import { MemoryTokenStore } from "./testing/memory-token-store.ts";
import { SequentialIds } from "./testing/sequential-ids.ts";

function deps(signedIn: boolean): AppDependencies {
  const auth = new FakeAuth();
  const api = new FakePactJoyApi(noCircleTodayFixture());
  const store = new MemoryTokenStore(signedIn ? fakeSession() : null);
  return {
    auth,
    api,
    ids: new SequentialIds(),
    connectivity: new FakeConnectivity(),
    store,
    sessions: new SessionManager(auth, store, new FixedClock(0)),
    sessionEvents: createSessionEvents(),
    queryClient: new QueryClient(),
    persister: createTodayPersister(new MemoryStorage()),
  };
}

describe("App", () => {
  it("renders the shell with the tab bar for a signed-in user", () => {
    render(<App deps={deps(true)} />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Principal" })).toBeInTheDocument();
  });

  it("renders the login screen for a visitor", () => {
    render(<App deps={deps(false)} />);
    expect(screen.getByRole("heading", { name: "Entrar" })).toBeInTheDocument();
  });
});
