import type { UserId } from "../shared/ids.ts";

/** Server-side identity erasure, outside the data transaction. Missing identities count as done. */
export interface IdentityAdmin {
  deleteUser(userId: UserId): Promise<void>;
}

/** Infrastructure failure with no upstream response, identifier or credential in its message. */
export class IdentityAdminError extends Error {
  constructor(readonly code: "unavailable" | "rejected") {
    super(code);
    this.name = "IdentityAdminError";
  }
}
