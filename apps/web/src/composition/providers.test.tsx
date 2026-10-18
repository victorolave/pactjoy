import { QueryClient } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalStorageDeviceStore } from "../adapters/local-storage-device-store.ts";
import { createTodayPersister } from "../adapters/query-persister.ts";
import { useIds } from "../context/ids-context.tsx";
import { useToasts } from "../context/toast-context.tsx";
import { createSessionEvents, SessionManager, useSession } from "../features/auth/index.ts";
import {
  type Outbox,
  useOutbox,
  useOutboxReplaying,
  useOutboxState,
} from "../features/entry/index.ts";
import { ApiError } from "../ports/api-error.ts";
import type { OutboxState } from "../ports/outbox-store.ts";
import { progressKey, socialKey, todayKey } from "../shared/query-keys.ts";
import { FakeAppInstall } from "../testing/fake-app-install.ts";
import { FakeAuth, fakeSession } from "../testing/fake-auth.ts";
import { FakeConnectivity } from "../testing/fake-connectivity.ts";
import { FakeHaptics } from "../testing/fake-haptics.ts";
import { FakeImageProcessor } from "../testing/fake-image-processor.ts";
import { FakeNotificationPermission } from "../testing/fake-notification-permission.ts";
import { FakePactJoyApi } from "../testing/fake-pactjoy-api.ts";
import { FakePhotoUploader } from "../testing/fake-photo-uploader.ts";
import { FakePushSubscription } from "../testing/fake-push-subscription.ts";
import { FakeReminderNames } from "../testing/fake-reminder-names.ts";
import { FakeSharing } from "../testing/fake-sharing.ts";
import { FakeVisibility } from "../testing/fake-visibility.ts";
import { FixedClock } from "../testing/fixed-clock.ts";
import { noCircleTodayFixture } from "../testing/fixtures/today.ts";
import { MemoryLock } from "../testing/memory-lock.ts";
import { MemoryOutboxStore } from "../testing/memory-outbox-store.ts";
import { MemoryStorage } from "../testing/memory-storage.ts";
import { MemoryTokenStore } from "../testing/memory-token-store.ts";
import { sampleOutbox } from "../testing/outbox-store-contract.ts";
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
    imageProcessor: new FakeImageProcessor(),
    photoUploader: new FakePhotoUploader(),
    haptics: new FakeHaptics(),
    connectivity: new FakeConnectivity(),
    store,
    device: new LocalStorageDeviceStore(new MemoryStorage()),
    sharing: new FakeSharing(),
    appInstall: new FakeAppInstall(),
    notifications: new FakeNotificationPermission(),
    push: new FakePushSubscription(),
    reminderNames: new FakeReminderNames(),
    outboxStore: new MemoryOutboxStore(),
    visibility: new FakeVisibility(),
    locks: new MemoryLock(),
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

  it("a deleted account drops the cache, the saved copy and this device's push subscription, with no remote sign-out", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["today"], { state: "noCircle" });
    const push = new FakePushSubscription();
    await push.subscribe("BFAKE-VAPID-KEY");
    const base = deps({ queryClient, push });
    const auth = base.auth as FakeAuth;
    function Delete() {
      const { accountDeleted } = useSession();
      return (
        <button type="button" onClick={accountDeleted}>
          borrar
        </button>
      );
    }
    render(
      <AppProviders deps={base}>
        <Who />
        <Delete />
      </AppProviders>,
    );
    act(() => screen.getByRole("button", { name: "borrar" }).click());
    expect(screen.getByLabelText("who")).toHaveTextContent("none");
    expect(queryClient.getQueryData(["today"])).toBeUndefined();
    await waitFor(() => expect(push.device).toBeNull());
    expect(auth.signedOut).toEqual([]);
  });

  describe("the outbox is erased with the session (OE-R6)", () => {
    function setup() {
      const outboxStore = new MemoryOutboxStore();
      outboxStore.save("user-1", sampleOutbox());
      const store = new MemoryTokenStore(fakeSession());
      const sessionEvents = createSessionEvents();
      const base = deps({ outboxStore, store, sessionEvents });
      function Controls() {
        const { signOut, accountDeleted } = useSession();
        return (
          <>
            <button type="button" onClick={() => void signOut()}>
              salir
            </button>
            <button type="button" onClick={accountDeleted}>
              borrar
            </button>
          </>
        );
      }
      render(
        <AppProviders deps={base}>
          <Who />
          <Controls />
        </AppProviders>,
      );
      return { outboxStore, store, sessionEvents };
    }

    it("clears it on sign-out", async () => {
      const { outboxStore } = setup();
      act(() => screen.getByRole("button", { name: "salir" }).click());
      await waitFor(() => expect(outboxStore.clears).toBe(1));
      expect(outboxStore.load("user-1").items).toEqual([]);
    });

    it("clears it when the session expires", () => {
      const { outboxStore, sessionEvents } = setup();
      act(() => sessionEvents.expire());
      expect(outboxStore.clears).toBe(1);
      expect(outboxStore.load("user-1").items).toEqual([]);
    });

    it("clears it when the account is deleted (OE-R6.S1)", () => {
      const { outboxStore } = setup();
      act(() => screen.getByRole("button", { name: "borrar" }).click());
      expect(outboxStore.clears).toBe(1);
      expect(outboxStore.load("user-1").items).toEqual([]);
    });

    it("clears it when another tab signs out (OE-R6.S5)", () => {
      const { outboxStore, store } = setup();
      act(() => store.emitExternal(null));
      expect(outboxStore.clears).toBe(1);
    });
  });

  describe("unsent entries and the end of the session (OE-R6)", () => {
    function Discarded() {
      return <output aria-label="discarded">{useSession().discardedEntries}</output>;
    }
    function SignOut() {
      const { signOut } = useSession();
      return (
        <button type="button" onClick={() => void signOut()}>
          salir
        </button>
      );
    }
    const setup = (overrides: Partial<AppDependencies> = {}) => {
      const outboxStore = new MemoryOutboxStore();
      outboxStore.save("user-1", sampleOutbox());
      const sessionEvents = createSessionEvents();
      const base = deps({
        outboxStore,
        sessionEvents,
        connectivity: new FakeConnectivity(false),
        ...overrides,
      });
      render(
        <AppProviders deps={base}>
          <Who />
          <Discarded />
          <SignOut />
        </AppProviders>,
      );
      return { base, outboxStore, sessionEvents };
    };

    it("an expiry reports how many entries it erased, counted before they are cleared (OE-R6.S4)", () => {
      const { outboxStore, sessionEvents } = setup();
      act(() => sessionEvents.expire());
      expect(screen.getByLabelText("discarded")).toHaveTextContent("2");
      expect(outboxStore.load("user-1").items).toEqual([]);
    });

    it("signing out tries one last replay of the queue within the grace (OE-R6.S3)", async () => {
      const api = new FakePactJoyApi(noCircleTodayFixture());
      // The replay that starts with the app fails, so the queue is still full at sign-out.
      api.failNext("recordEntry", new ApiError("ServiceUnavailable", 503, null));
      const { outboxStore } = setup({ api, connectivity: new FakeConnectivity(true) });
      await waitFor(() => expect(api.recordAttempts).toHaveLength(1));
      act(() => screen.getByRole("button", { name: "salir" }).click());
      await waitFor(() => expect(screen.getByLabelText("who")).toHaveTextContent("none"));
      expect(api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["req-1"]);
      expect(outboxStore.load("user-1").items).toEqual([]);
    });
  });

  describe("the outbox of the signed-in user (OE-R3, OE-R4)", () => {
    const queuedRecord = (): OutboxState => ({
      v: 1,
      items: [
        {
          kind: "record",
          localId: "a",
          attempted: false,
          habitName: "Leer",
          command: {
            seasonId: "s1",
            commitmentId: "c1",
            forDate: "2026-10-13",
            value: { kind: "done" },
            note: null,
            clientRequestId: "req-a",
          },
        },
      ],
      notices: [],
    });

    it("replays what is queued when the app starts with a session, then refreshes Today, progress and the feed (OE-R4.S2)", async () => {
      const outboxStore = new MemoryOutboxStore();
      outboxStore.save("user-1", queuedRecord());
      const queryClient = new QueryClient();
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      const base = deps({ outboxStore, queryClient });
      render(
        <AppProviders deps={base}>
          <Who />
        </AppProviders>,
      );
      const api = base.api as FakePactJoyApi;
      await waitFor(() =>
        expect(api.recorded.map((cmd) => cmd.clientRequestId)).toEqual(["req-a"]),
      );
      await waitFor(() =>
        expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
          expect.arrayContaining([todayKey, progressKey, socialKey]),
        ),
      );
      expect(outboxStore.load("user-1").items).toEqual([]);
    });

    it("replays under a lock named for the user, so two tabs take turns (W2)", async () => {
      const outboxStore = new MemoryOutboxStore();
      outboxStore.save("user-1", queuedRecord());
      const locks = new MemoryLock();
      const base = deps({ outboxStore, locks });
      render(
        <AppProviders deps={base}>
          <Who />
        </AppProviders>,
      );
      await waitFor(() => expect(outboxStore.load("user-1").items).toEqual([]));
      expect(locks.requested).toContain("pactjoy.outbox:user-1");
    });

    it("stops before the next send once the stored session belongs to another user (S1)", async () => {
      const outboxStore = new MemoryOutboxStore();
      const two = queuedRecord();
      const [first] = two.items;
      if (first?.kind !== "record") throw new Error("record fixture");
      const second = {
        ...first,
        localId: "b",
        command: { ...first.command, clientRequestId: "req-b" },
      };
      outboxStore.save("user-1", { ...two, items: [first, second] });
      const store = new MemoryTokenStore(fakeSession());
      const base = deps({ outboxStore, store });
      const api = base.api as FakePactJoyApi;
      const release = api.hold("recordEntry");
      render(
        <AppProviders deps={base}>
          <Who />
        </AppProviders>,
      );
      await waitFor(() => expect(api.recordAttempts).toHaveLength(1));
      // Another tab signed in someone else; this tab's React state has not caught up yet.
      store.save(fakeSession({ userId: "user-2" }));
      release();
      await act(async () => {});
      expect(api.recordAttempts.map((cmd) => cmd.clientRequestId)).toEqual(["req-a"]);
    });

    it("never replays another user's items with this user's token (OE-R3.S2)", async () => {
      const outboxStore = new MemoryOutboxStore();
      outboxStore.save("user-1", queuedRecord());
      const store = new MemoryTokenStore(fakeSession({ userId: "user-2" }));
      const base = deps({ outboxStore, store });
      const seen: (Outbox | null)[] = [];
      function Probe() {
        seen.push(useOutbox());
        return null;
      }
      render(
        <AppProviders deps={base}>
          <Probe />
        </AppProviders>,
      );
      await act(async () => {});
      const api = base.api as FakePactJoyApi;
      expect(api.recordAttempts).toEqual([]);
      expect(seen.at(-1)?.snapshot().items).toEqual([]);
    });

    it("has no outbox while signed out, and a new one for the next user", () => {
      const store = new MemoryTokenStore(null);
      const base = deps({ store });
      const seen: (Outbox | null)[] = [];
      function Probe() {
        seen.push(useOutbox());
        return null;
      }
      render(
        <AppProviders deps={base}>
          <Probe />
        </AppProviders>,
      );
      expect(seen.at(-1)).toBeNull();
      act(() => store.emitExternal(fakeSession({ userId: "user-2" })));
      const first = seen.at(-1);
      expect(first).not.toBeNull();
      act(() => store.emitExternal(fakeSession({ userId: "user-3" })));
      expect(seen.at(-1)).not.toBeNull();
      expect(seen.at(-1)).not.toBe(first);
    });

    it("does not resubscribe to the outbox on every render", () => {
      const base = deps({ store: new MemoryTokenStore(fakeSession({ userId: "user-2" })) });
      let outbox: Outbox | null = null;
      function Probe() {
        outbox = useOutbox();
        useOutboxState();
        useOutboxReplaying();
        return null;
      }
      const view = render(
        <AppProviders deps={base}>
          <Probe />
        </AppProviders>,
      );
      const subscribe = vi.spyOn(outbox as unknown as Outbox, "subscribe");
      view.rerender(
        <AppProviders deps={base}>
          <Probe />
        </AppProviders>,
      );
      view.rerender(
        <AppProviders deps={base}>
          <Probe />
        </AppProviders>,
      );
      expect(subscribe).not.toHaveBeenCalled();
    });

    it("disposes the outbox of the user who left, and the last one on unmount", () => {
      const outboxStore = new MemoryOutboxStore();
      const store = new MemoryTokenStore(fakeSession({ userId: "user-2" }));
      const base = deps({ outboxStore, store });
      const seen: (Outbox | null)[] = [];
      function Probe() {
        seen.push(useOutbox());
        return null;
      }
      const view = render(
        <AppProviders deps={base}>
          <Probe />
        </AppProviders>,
      );
      const first = seen.at(-1) as Outbox;
      act(() => store.emitExternal(fakeSession({ userId: "user-3" })));
      const second = seen.at(-1) as Outbox;
      expect(second).not.toBe(first);
      // A disposed outbox no longer follows the store.
      act(() => outboxStore.emitExternal("user-2", queuedRecord()));
      expect(first.snapshot().items).toEqual([]);
      act(() => outboxStore.emitExternal("user-3", queuedRecord()));
      expect(second.snapshot().items).toHaveLength(1);
      view.unmount();
      act(() => outboxStore.emitExternal("user-3", { v: 1, items: [], notices: [] }));
      expect(second.snapshot().items).toHaveLength(1);
    });
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
