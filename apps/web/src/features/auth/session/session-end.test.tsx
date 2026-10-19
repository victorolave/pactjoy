import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FakeAuth, fakeSession } from "../../../testing/fake-auth.ts";
import { FixedClock } from "../../../testing/fixed-clock.ts";
import { MemoryTokenStore } from "../../../testing/memory-token-store.ts";
import { SessionProvider, useSession } from "./session-context.tsx";
import { SessionManager } from "./session-manager.ts";

function Probe() {
  const { session, expire, signOut, accountDeleted, verifyCode } = useSession();
  return (
    <div>
      <output aria-label="who">{session?.userId ?? "none"}</output>
      <button type="button" onClick={expire}>
        expirar
      </button>
      <button type="button" onClick={() => void signOut()}>
        salir
      </button>
      <button type="button" onClick={accountDeleted}>
        borrar
      </button>
      <button type="button" onClick={() => void verifyCode("victor@example.com", "123456")}>
        entrar
      </button>
    </div>
  );
}

function setup(initial: ReturnType<typeof fakeSession> | null = fakeSession()) {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(initial);
  const events: string[] = [];
  render(
    <SessionProvider
      auth={auth}
      store={store}
      manager={new SessionManager(auth, store, new FixedClock(1_000_000))}
      onSessionEnd={(reason) => events.push(`end:${reason}`)}
      onSessionStart={(userId) =>
        events.push(`start:${userId}:${store.load()?.userId ?? "unsaved"}`)
      }
    >
      <Probe />
    </SessionProvider>,
  );
  return { auth, store, events };
}

const click = (name: string) => userEvent.click(screen.getByRole("button", { name }));

describe("why the session ended, and who starts the next one (W4)", () => {
  it("an expiry says it expired", async () => {
    const { events } = setup();
    await click("expirar");
    expect(events).toEqual(["end:expired"]);
  });

  it("a sign-out the member chose says so", async () => {
    const { events } = setup();
    await click("salir");
    await waitFor(() => expect(events).toEqual(["end:signedOut"]));
  });

  it("a deleted account says so", async () => {
    const { events } = setup();
    await click("borrar");
    expect(events).toEqual(["end:accountDeleted"]);
  });

  it("another tab ending the session says it ended elsewhere", () => {
    const { store, events } = setup();
    store.emitExternal(null);
    expect(events).toEqual(["end:elsewhere"]);
  });

  it("a sign-in names its user before the session is saved or shown", async () => {
    const { auth, events } = setup(null);
    auth.session = fakeSession({ userId: "user-2" });
    await click("entrar");
    await waitFor(() => expect(screen.getByLabelText("who")).toHaveTextContent("user-2"));
    expect(events).toEqual(["start:user-2:unsaved"]);
  });

  it("another tab signing in a different user names that user too", () => {
    const { store, events } = setup();
    store.emitExternal(fakeSession({ userId: "user-2" }));
    expect(events).toEqual(["end:elsewhere", "start:user-2:user-2"]);
  });

  it("another tab refreshing the same user's tokens starts nothing", () => {
    const { store, events } = setup();
    store.emitExternal(fakeSession({ accessToken: "access-2" }));
    expect(events).toEqual([]);
  });
});
