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

function setup(unsent = 0) {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(fakeSession());
  render(
    <SessionProvider
      auth={auth}
      store={store}
      manager={new SessionManager(auth, store, new FixedClock(0))}
      unsentCount={() => unsent}
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

  it("says how many unsent entries the expiry erased (OE-R6.S4)", async () => {
    setup(2);
    await userEvent.click(screen.getByRole("button", { name: "expirar" }));
    expect(screen.getByText("Tu sesión expiró. Entra de nuevo.")).toBeInTheDocument();
    expect(
      screen.getByText("Se borraron 2 registros sin enviar al cerrarse la sesión."),
    ).toBeInTheDocument();
  });

  it("uses the singular for one", async () => {
    setup(1);
    await userEvent.click(screen.getByRole("button", { name: "expirar" }));
    expect(
      screen.getByText("Se borró 1 registro sin enviar al cerrarse la sesión."),
    ).toBeInTheDocument();
  });

  it("says nothing about entries when none were lost, or when the account was deleted", async () => {
    setup(0);
    await userEvent.click(screen.getByRole("button", { name: "expirar" }));
    expect(screen.queryByText(/sin enviar/)).not.toBeInTheDocument();
  });

  it("does not mention entries after an account deletion", async () => {
    setup(2);
    await userEvent.click(screen.getByRole("button", { name: "cuenta borrada" }));
    expect(screen.queryByText(/sin enviar/)).not.toBeInTheDocument();
  });

  it("keeps saying the session expired when it only expired", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "expirar" }));
    expect(screen.getByText("Tu sesión expiró. Entra de nuevo.")).toBeInTheDocument();
    expect(screen.queryByText("Tu cuenta se eliminó")).not.toBeInTheDocument();
  });
});
