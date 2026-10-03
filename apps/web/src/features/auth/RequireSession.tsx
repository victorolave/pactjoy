import { Navigate, Outlet } from "react-router";
import { useSession } from "./session-context.tsx";

/** Layout route: the tab routes need a session (AU-R3). */
export function RequireSession() {
  const { session } = useSession();
  return session === null ? <Navigate to="/login" replace /> : <Outlet />;
}

/** Layout route: a signed-in user has nothing to do on the login screens. */
export function RedirectIfSignedIn() {
  const { session } = useSession();
  return session === null ? <Outlet /> : <Navigate to="/" replace />;
}
