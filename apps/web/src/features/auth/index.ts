/**
 * The public API of the auth feature: the login screens, the session gate and the session objects
 * the composition root builds. Everything else under `features/auth` is internal.
 */
export { CodeStep } from "./login/CodeStep.tsx";
export { EmailStep } from "./login/EmailStep.tsx";
export { LoginLayout } from "./login/LoginLayout.tsx";
export { RedirectIfSignedIn, RequireSession } from "./session/RequireSession.tsx";
export {
  type SessionEndReason,
  SessionProvider,
  SIGN_OUT_GRACE_MS,
  useSession,
} from "./session/session-context.tsx";
export { createSessionEvents, type SessionEvents } from "./session/session-events.ts";
export { SessionManager } from "./session/session-manager.ts";
