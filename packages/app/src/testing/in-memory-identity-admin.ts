import { type IdentityAdmin, IdentityAdminError } from "../ports/identity-admin.ts";
import type { UserId } from "../shared/ids.ts";

export interface InMemoryIdentityAdmin extends IdentityAdmin {
  readonly deleted: readonly UserId[];
  setFailure(code: "unavailable" | "rejected" | null): void;
}

/** Recording fake: repeating a successful deletion models the adapter's already-absent outcome. */
export function createInMemoryIdentityAdmin(): InMemoryIdentityAdmin {
  const deleted: UserId[] = [];
  let failure: "unavailable" | "rejected" | null = null;
  return {
    deleted,
    setFailure(code) {
      failure = code;
    },
    async deleteUser(id) {
      if (failure !== null) throw new IdentityAdminError(failure);
      deleted.push(id);
    },
  };
}
