import { AuthError, type AuthErrorCode, type AuthPort, type Session } from "../ports/auth.ts";

export const fakeSession = (overrides: Partial<Session> = {}): Session => ({
  accessToken: "access-1",
  refreshToken: "refresh-1",
  expiresAt: 2_000_000_000,
  userId: "user-1",
  email: "andrea@example.com",
  ...overrides,
});

/** Scriptable AuthPort. The code `123456` is the only valid one unless `validCode` changes. */
export class FakeAuth implements AuthPort {
  validCode = "123456";
  readonly requested: string[] = [];
  readonly verified: Array<{ email: string; code: string }> = [];
  readonly refreshed: string[] = [];
  readonly signedOut: string[] = [];
  /** The session `verifyCode` and `refresh` resolve. `refresh` bumps the token suffix. */
  session: Session = fakeSession();
  #failure: AuthErrorCode | null = null;
  #refreshGate: Promise<void> | null = null;

  /** The next call (any method except signOut) rejects with this code. */
  failNextWith(code: AuthErrorCode): void {
    this.#failure = code;
  }

  /** Holds `refresh` until the returned function is called (to test single-flight). */
  holdRefresh(): () => void {
    let release = () => {};
    this.#refreshGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    return release;
  }

  async requestCode(email: string): Promise<void> {
    this.#maybeFail();
    this.requested.push(email);
  }

  async verifyCode(email: string, code: string): Promise<Session> {
    this.#maybeFail();
    this.verified.push({ email, code });
    if (code !== this.validCode) throw new AuthError("InvalidCode");
    return this.session;
  }

  async refresh(refreshToken: string): Promise<Session> {
    this.refreshed.push(refreshToken);
    await this.#refreshGate;
    this.#maybeFail();
    this.session = {
      ...this.session,
      accessToken: `access-${this.refreshed.length + 1}`,
      refreshToken: `refresh-${this.refreshed.length + 1}`,
    };
    return this.session;
  }

  async signOut(accessToken: string): Promise<void> {
    this.signedOut.push(accessToken);
  }

  #maybeFail(): void {
    if (this.#failure === null) return;
    const code = this.#failure;
    this.#failure = null;
    throw new AuthError(code);
  }
}
