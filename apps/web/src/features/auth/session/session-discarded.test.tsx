import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { FakeAuth, fakeSession } from "../../../testing/fake-auth.ts";
import { FixedClock } from "../../../testing/fixed-clock.ts";
import { MemoryTokenStore } from "../../../testing/memory-token-store.ts";
import { SessionProvider, useSession } from "./session-context.tsx";
import { SessionManager } from "./session-manager.ts";

function Probe() {
  const { discardedEntries, expire, signOut, verifyCode } = useSession();
  return (
    <div>
      <output aria-label="discarded">{discardedEntries}</output>
      <button type="button" onClick={expire}>
        expirar
      </button>
      <button type="button" onClick={() => void signOut()}>
        salir
      </button>
      <button type="button" onClick={() => void verifyCode("andrea@example.com", "123456")}>
        entrar
      </button>
    </div>
  );
}

function setup(unsent: number) {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(fakeSession());
  const order: string[] = [];
  render(
    <SessionProvider
      auth={auth}
      store={store}
      manager={new SessionManager(auth, store, new FixedClock(1_000_000))}
      unsentCount={() => {
        order.push("count");
        return unsent;
      }}
      onSessionEnd={() => order.push("end")}
    >
      <Probe />
    </SessionProvider>,
  );
  return { order };
}

const discarded = () => screen.getByLabelText("discarded");

describe("entries discarded when the session expires (OE-R6.S4)", () => {
  it("reads how many were unsent BEFORE the app erases them, and exposes it", async () => {
    const { order } = setup(3);
    expect(discarded()).toHaveTextContent("0");
    await userEvent.click(screen.getByRole("button", { name: "expirar" }));
    expect(discarded()).toHaveTextContent("3");
    expect(order).toEqual(["count", "end"]);
  });

  it("is zero when nothing was queued", async () => {
    setup(0);
    await userEvent.click(screen.getByRole("button", { name: "expirar" }));
    expect(discarded()).toHaveTextContent("0");
  });

  it("a sign-out the member chose reports nothing: they were asked first", async () => {
    setup(3);
    await userEvent.click(screen.getByRole("button", { name: "salir" }));
    await waitFor(() => expect(discarded()).toHaveTextContent("0"));
  });

  it("is forgotten at the next sign in", async () => {
    setup(2);
    await userEvent.click(screen.getByRole("button", { name: "expirar" }));
    expect(discarded()).toHaveTextContent("2");
    await userEvent.click(screen.getByRole("button", { name: "entrar" }));
    await waitFor(() => expect(discarded()).toHaveTextContent("0"));
  });
});
