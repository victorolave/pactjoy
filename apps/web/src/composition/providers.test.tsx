import { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LocalStorageDeviceStore } from "../adapters/local-storage-device-store.ts";
import { createTodayPersister } from "../adapters/query-persister.ts";
import { useIds } from "../context/ids-context.tsx";
import { useToasts } from "../context/toast-context.tsx";
import { createSessionEvents, SessionManager, useSession } from "../features/auth/index.ts";
import { FakeAuth, fakeSession } from "../testing/fake-auth.ts";
import { FakeConnectivity } from "../testing/fake-connectivity.ts";
import { FakeHaptics } from "../testing/fake-haptics.ts";
import { FakePactJoyApi } from "../testing/fake-pactjoy-api.ts";
import { FakeSharing } from "../testing/fake-sharing.ts";
import { FixedClock } from "../testing/fixed-clock.ts";
import { noCircleTodayFixture } from "../testing/fixtures/today.ts";
import { MemoryStorage } from "../testing/memory-storage.ts";
import { MemoryTokenStore } from "../testing/memory-token-store.ts";
import { SequentialIds } from "../testing/sequential-ids.ts";
import type { AppDependencies } from "./dependencies.ts";
import { AppProviders } from "./providers.tsx";

function deps(overrides: Partial<AppDependencies> = {}): AppDependencies {
  const auth = new FakeAuth();
  const api = new FakePactJoyApi(noCircleTodayFixture());
  const store = new MemoryTokenStore(fakeSession());
  return {
    auth,
    api,
    ids: new SequentialIds(),
    haptics: new FakeHaptics(),
    connectivity: new FakeConnectivity(),
    store,
    device: new LocalStorageDeviceStore(new MemoryStorage()),
    sharing: new FakeSharing(),
    clock: new FixedClock(0),
    sessions: new SessionManager(auth, store, new FixedClock(0)),
    sessionEvents: createSessionEvents(),
    queryClient: new QueryClient(),
    persister: createTodayPersister(new MemoryStorage()),
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

  it("clears only the name draft when the session ends; device flags survive (owner decision)", () => {
    const device = new LocalStorageDeviceStore(new MemoryStorage());
    for (const key of ["welcomeSeen", "installStep", "notificationStep", "nameDraft"] as const) {
      device.set(key, "1");
    }
    const sessionEvents = createSessionEvents();
    render(
      <AppProviders deps={deps({ device, sessionEvents })}>
        <Who />
      </AppProviders>,
    );
    act(() => sessionEvents.expire());
    expect(device.get("nameDraft")).toBeNull();
    expect(
      (["welcomeSeen", "installStep", "notificationStep"] as const).map((key) => device.get(key)),
    ).toEqual(["1", "1", "1"]);
  });

  it("provides the ids port and the toast host to the tree", () => {
    function Probe() {
      const id = useIds().newId();
      const { show } = useToasts();
      return (
        <button type="button" onClick={() => show({ message: id })}>
          probar
        </button>
      );
    }
    render(
      <AppProviders deps={deps()}>
        <Probe />
      </AppProviders>,
    );
    screen.getByRole("button", { name: "probar" }).click();
    return waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("id-1"));
  });
});
