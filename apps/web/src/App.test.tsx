import { QueryClient } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App.tsx";
import type { AppDependencies } from "./app/dependencies.ts";
import { createSessionEvents } from "./features/auth/session-events.ts";
import { SessionManager } from "./features/auth/session-manager.ts";
import { FakeAuth, fakeSession } from "./testing/fake-auth.ts";
import { FixedClock } from "./testing/fixed-clock.ts";
import { MemoryTokenStore } from "./testing/memory-token-store.ts";

function deps(signedIn: boolean): AppDependencies {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(signedIn ? fakeSession() : null);
  return {
    auth,
    store,
    sessions: new SessionManager(auth, store, new FixedClock(0)),
    sessionEvents: createSessionEvents(),
    queryClient: new QueryClient(),
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
