import type { TodayView } from "@pactjoy/app";
import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import { createTodayPersister } from "./adapters/query-persister.ts";
import type { AppDependencies } from "./composition/dependencies.ts";
import { createSessionEvents, SessionManager } from "./features/auth/index.ts";
import { FakeAuth, fakeSession } from "./testing/fake-auth.ts";
import { FakeConnectivity } from "./testing/fake-connectivity.ts";
import { FakeHaptics } from "./testing/fake-haptics.ts";
import { FakePactJoyApi } from "./testing/fake-pactjoy-api.ts";
import { FixedClock } from "./testing/fixed-clock.ts";
import { activeTodayFixture, noCircleTodayFixture } from "./testing/fixtures/today.ts";
import { MemoryStorage } from "./testing/memory-storage.ts";
import { MemoryTokenStore } from "./testing/memory-token-store.ts";
import { seedPersistedToday } from "./testing/seed-persisted-today.ts";
import { SequentialIds } from "./testing/sequential-ids.ts";

function deps(signedIn: boolean): AppDependencies {
  const auth = new FakeAuth();
  const api = new FakePactJoyApi(noCircleTodayFixture());
  const store = new MemoryTokenStore(signedIn ? fakeSession() : null);
  return {
    auth,
    api,
    ids: new SequentialIds(),
    haptics: new FakeHaptics(),
    connectivity: new FakeConnectivity(),
    store,
    sessions: new SessionManager(auth, store, new FixedClock(0)),
    sessionEvents: createSessionEvents(),
    queryClient: new QueryClient(),
    persister: createTodayPersister(new MemoryStorage()),
  };
}

describe("App with a saved Today from before the shape changed", () => {
  it("shows the app, not a blank screen: the old copy is dropped", async () => {
    const storage = new MemoryStorage();
    // A running Today as an older build saved it: no `points` on its rows, no `pointsToday`.
    const old = activeTodayFixture();
    const stale = {
      ...old,
      summary: { week: 1, weekCount: 4, daysLeft: 23, score: old.summary.score },
      rows: old.rows.map(({ points: _points, ...row }) => row),
    };
    seedPersistedToday(storage, stale as unknown as TodayView);
    const dependencies = { ...deps(true), persister: createTodayPersister(storage) };
    dependencies.api = new FakePactJoyApi(noCircleTodayFixture());
    render(<App deps={dependencies} />);
    expect(
      await screen.findByRole("heading", { name: "Aún no estás en un círculo" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

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
