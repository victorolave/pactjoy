import { Navigate, Route, Routes } from "react-router";
import { RedirectIfSignedIn, RequireSession } from "../features/auth/RequireSession.tsx";
import { StubScreen } from "../features/stubs/StubScreen.tsx";
import { AppShell } from "./AppShell.tsx";

/** Route table. `/` and `/login` hold placeholders until Today and Login land. */
export function AppRoutes() {
  return (
    <Routes>
      <Route element={<RedirectIfSignedIn />}>
        <Route
          path="/login"
          element={
            <main>
              <StubScreen title="Entrar" />
            </main>
          }
        />
      </Route>
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<StubScreen title="Hoy" />} />
          <Route path="season" element={<StubScreen title="Temporada" />} />
          <Route path="circle" element={<StubScreen title="Círculo" />} />
          <Route path="profile" element={<StubScreen title="Perfil" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
