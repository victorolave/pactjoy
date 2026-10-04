import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { FakeAuth, fakeSession } from "../../../testing/fake-auth.ts";
import { FixedClock } from "../../../testing/fixed-clock.ts";
import { MemoryTokenStore } from "../../../testing/memory-token-store.ts";
import { RedirectIfSignedIn, RequireSession } from "./RequireSession.tsx";
import { SessionProvider } from "./session-context.tsx";
import { SessionManager } from "./session-manager.ts";

function renderAt(path: string, signedIn: boolean) {
  const auth = new FakeAuth();
  const store = new MemoryTokenStore(signedIn ? fakeSession() : null);
  render(
    <SessionProvider
      auth={auth}
      store={store}
      manager={new SessionManager(auth, store, new FixedClock(0))}
    >
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<RedirectIfSignedIn />}>
            <Route path="/login" element={<p>pantalla de entrada</p>} />
          </Route>
          <Route element={<RequireSession />}>
            <Route index element={<p>pantalla privada</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe("RequireSession (AU-R3, AU-S5)", () => {
  it("sends a visitor without a session to /login", () => {
    renderAt("/", false);
    expect(screen.getByText("pantalla de entrada")).toBeInTheDocument();
    expect(screen.queryByText("pantalla privada")).not.toBeInTheDocument();
  });

  it("lets a signed-in user through", () => {
    renderAt("/", true);
    expect(screen.getByText("pantalla privada")).toBeInTheDocument();
  });
});

describe("RedirectIfSignedIn (AU-R3)", () => {
  it("sends a signed-in user from /login to Today", () => {
    renderAt("/login", true);
    expect(screen.getByText("pantalla privada")).toBeInTheDocument();
  });

  it("shows the login screen to a visitor", () => {
    renderAt("/login", false);
    expect(screen.getByText("pantalla de entrada")).toBeInTheDocument();
  });
});
