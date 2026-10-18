import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FakeAuth, fakeSession } from "../../../testing/fake-auth.ts";
import { FixedClock } from "../../../testing/fixed-clock.ts";
import { MemoryTokenStore } from "../../../testing/memory-token-store.ts";
import { SessionProvider, useSession } from "../session/session-context.tsx";
import { SessionManager } from "../session/session-manager.ts";
import { EmailStep } from "./EmailStep.tsx";

function EndButtons() {
  const { expire, accountDeleted } = useSession();
  return (
    <>
      <button type="button" onClick={expire}>
        expirar
      </button>
      <button type="button" onClick={accountDeleted}>
        cuenta borrada
      </button>
    </>
  );
}

function setup() {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(fakeSession());
  render(
    <SessionProvider
      auth={auth}
      store={store}
      manager={new SessionManager(auth, store, new FixedClock(0))}
    >
      <MemoryRouter>
        <EndButtons />
        <EmailStep />
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe("EmailStep notices", () => {
  it("says the account is gone after a deletion, and not that the session expired", async () => {
    setup();
    expect(screen.queryByText("Tu cuenta se eliminó")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "cuenta borrada" }));
    expect(screen.getByText("Tu cuenta se eliminó")).toBeInTheDocument();
    expect(screen.queryByText("Tu sesión expiró. Entra de nuevo.")).not.toBeInTheDocument();
  });

  it("keeps saying the session expired when it only expired", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "expirar" }));
    expect(screen.getByText("Tu sesión expiró. Entra de nuevo.")).toBeInTheDocument();
    expect(screen.queryByText("Tu cuenta se eliminó")).not.toBeInTheDocument();
  });
});
