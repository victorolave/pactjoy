import { QueryClient } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useSession } from "../features/auth/session-context.tsx";
import { createSessionEvents } from "../features/auth/session-events.ts";
import { SessionManager } from "../features/auth/session-manager.ts";
import { FakeAuth, fakeSession } from "../testing/fake-auth.ts";
import { FixedClock } from "../testing/fixed-clock.ts";
import { MemoryTokenStore } from "../testing/memory-token-store.ts";
import type { AppDependencies } from "./dependencies.ts";
import { AppProviders } from "./providers.tsx";

function deps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(fakeSession());
  return {
    auth,
    store,
    sessions: new SessionManager(auth, store, new FixedClock(0)),
    sessionEvents: createSessionEvents(),
    queryClient: new QueryClient(),
    ...overrides,
  };
}

function Who() {
  return <output aria-label="who">{useSession().session?.userId ?? "none"}</output>;
}

describe("AppProviders", () => {
  it("provides the session from the store", () => {
    render(
      <AppProviders deps={deps()}>
        <Who />
      </AppProviders>,
    );
    expect(screen.getByLabelText("who")).toHaveTextContent("user-1");
  });

  it("drops cached data when the API reports an unauthorized session (AU-S6)", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["today"], { state: "noCircle" });
    const sessionEvents = createSessionEvents();
    render(
      <AppProviders deps={deps({ queryClient, sessionEvents })}>
        <Who />
      </AppProviders>,
    );
    expect(queryClient.getQueryData(["today"])).toEqual({ state: "noCircle" });
    act(() => sessionEvents.expire());
    expect(screen.getByLabelText("who")).toHaveTextContent("none");
    expect(queryClient.getQueryData(["today"])).toBeUndefined();
  });
});
