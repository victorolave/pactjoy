import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthError, type Session } from "../../ports/auth.ts";
import { FakeAuth, fakeSession } from "../../testing/fake-auth.ts";
import { FixedClock } from "../../testing/fixed-clock.ts";
import { MemoryTokenStore } from "../../testing/memory-token-store.ts";
import { SessionProvider, useSession } from "./session-context.tsx";
import { createSessionEvents } from "./session-events.ts";
import { SessionManager } from "./session-manager.ts";

function Probe() {
  const { session, notice, requestCode, verifyCode, signOut, expire } = useSession();
  return (
    <div>
      <output aria-label="user">{session?.userId ?? "none"}</output>
      <output aria-label="notice">{notice ?? "none"}</output>
      <button type="button" onClick={() => void requestCode("andrea@example.com")}>
        pedir
      </button>
      <button
        type="button"
        onClick={() => void verifyCode("andrea@example.com", "123456").catch(() => {})}
      >
        verificar
      </button>
      <button
        type="button"
        onClick={() => void verifyCode("andrea@example.com", "000000").catch(() => {})}
      >
        verificar mal
      </button>
      <button type="button" onClick={() => void signOut()}>
        salir
      </button>
      <button type="button" onClick={expire}>
        expirar
      </button>
    </div>
  );
}

function setup(initial: Session | null = fakeSession()) {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(initial);
  const manager = new SessionManager(auth, store, new FixedClock(1_000_000));
  const onSessionEnd = vi.fn();
  render(
    <SessionProvider auth={auth} store={store} manager={manager} onSessionEnd={onSessionEnd}>
      <Probe />
    </SessionProvider>,
  );
  return { auth, store, onSessionEnd };
}

const user = () => screen.getByLabelText("user");

describe("SessionProvider", () => {
  it("starts from the stored session", () => {
    setup(fakeSession({ userId: "user-7" }));
    expect(user()).toHaveTextContent("user-7");
  });

  it("starts signed out when nothing is stored", () => {
    const auth = new FakeAuth();
    const store = new MemoryTokenStore();
    render(
      <SessionProvider
        auth={auth}
        store={store}
        manager={new SessionManager(auth, store, new FixedClock(0))}
      >
        <Probe />
      </SessionProvider>,
    );
    expect(user()).toHaveTextContent("none");
  });

  it("requests a code through the port", async () => {
    const { auth } = setup();
    await userEvent.click(screen.getByRole("button", { name: "pedir" }));
    expect(auth.requested).toEqual(["andrea@example.com"]);
  });

  it("stores and exposes the session after a valid code", async () => {
    const { store, auth } = setup(null);
    auth.session = fakeSession({ userId: "user-9" });
    await userEvent.click(screen.getByRole("button", { name: "verificar" }));
    await waitFor(() => expect(user()).toHaveTextContent("user-9"));
    expect(store.load()?.userId).toBe("user-9");
  });

  it("keeps the user signed out and rethrows when the code is wrong", async () => {
    const { store } = setup(null);
    await userEvent.click(screen.getByRole("button", { name: "verificar mal" }));
    expect(user()).toHaveTextContent("none");
    expect(store.load()).toBeNull();
  });

  it("clears the session, ends the remote one and tells the app on sign out", async () => {
    const { store, auth, onSessionEnd } = setup();
    await userEvent.click(screen.getByRole("button", { name: "salir" }));
    await waitFor(() => expect(user()).toHaveTextContent("none"));
    expect(store.load()).toBeNull();
    expect(auth.signedOut).toEqual(["access-1"]);
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("notice")).toHaveTextContent("none");
  });

  it("expire clears the session, flags the notice and tells the app, without a remote call", async () => {
    const { store, auth, onSessionEnd } = setup();
    await userEvent.click(screen.getByRole("button", { name: "expirar" }));
    expect(user()).toHaveTextContent("none");
    expect(screen.getByLabelText("notice")).toHaveTextContent("sessionExpired");
    expect(store.load()).toBeNull();
    expect(auth.signedOut).toEqual([]);
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
  });

  it("expires when the API layer reports an unauthorized request (AU-R5, AU-S6)", () => {
    const auth = new FakeAuth();
    const store = new MemoryTokenStore(fakeSession());
    const events = createSessionEvents();
    const onSessionEnd = vi.fn();
    render(
      <SessionProvider
        auth={auth}
        store={store}
        manager={new SessionManager(auth, store, new FixedClock(0))}
        expired={events}
        onSessionEnd={onSessionEnd}
      >
        <Probe />
      </SessionProvider>,
    );
    act(() => events.expire());
    expect(user()).toHaveTextContent("none");
    expect(screen.getByLabelText("notice")).toHaveTextContent("sessionExpired");
    expect(store.load()).toBeNull();
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
  });

  it("clears the notice on the next sign in", async () => {
    const { auth } = setup();
    await userEvent.click(screen.getByRole("button", { name: "expirar" }));
    auth.session = fakeSession({ userId: "user-2" });
    await userEvent.click(screen.getByRole("button", { name: "verificar" }));
    await waitFor(() => expect(user()).toHaveTextContent("user-2"));
    expect(screen.getByLabelText("notice")).toHaveTextContent("none");
  });

  it("follows another tab: a session written there shows here, and so does its sign out", async () => {
    const auth = new FakeAuth();
    const store = new MemoryTokenStore();
    render(
      <SessionProvider
        auth={auth}
        store={store}
        manager={new SessionManager(auth, store, new FixedClock(0))}
      >
        <Probe />
      </SessionProvider>,
    );
    act(() => store.emitExternal(fakeSession({ userId: "user-tab" })));
    expect(user()).toHaveTextContent("user-tab");
    act(() => store.emitExternal(null));
    expect(user()).toHaveTextContent("none");
  });

  it("tells the app when another tab ends the session, but not when it only refreshes it", () => {
    const auth = new FakeAuth();
    const store = new MemoryTokenStore(fakeSession());
    const onSessionEnd = vi.fn();
    render(
      <SessionProvider
        auth={auth}
        store={store}
        manager={new SessionManager(auth, store, new FixedClock(0))}
        onSessionEnd={onSessionEnd}
      >
        <Probe />
      </SessionProvider>,
    );
    act(() => store.emitExternal(fakeSession({ accessToken: "access-2" })));
    expect(onSessionEnd).not.toHaveBeenCalled();
    act(() => store.emitExternal(null));
    expect(onSessionEnd).toHaveBeenCalledTimes(1);
  });

  it("surfaces the port's AuthError to the caller", async () => {
    const auth = new FakeAuth();
    const store = new MemoryTokenStore();
    let caught: unknown;
    function Catcher() {
      const { requestCode } = useSession();
      return (
        <button
          type="button"
          onClick={() => requestCode("x@y.z").catch((e: unknown) => (caught = e))}
        >
          pedir
        </button>
      );
    }
    render(
      <SessionProvider
        auth={auth}
        store={store}
        manager={new SessionManager(auth, store, new FixedClock(0))}
      >
        <Catcher />
      </SessionProvider>,
    );
    auth.failNextWith("RateLimited");
    await userEvent.click(screen.getByRole("button", { name: "pedir" }));
    await waitFor(() => expect(caught).toBeInstanceOf(AuthError));
    expect((caught as AuthError).code).toBe("RateLimited");
  });
});
