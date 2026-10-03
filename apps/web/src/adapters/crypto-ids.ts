import type { IdSource } from "../ports/ids.ts";

export class CryptoIds implements IdSource {
  newId(): string {
    return crypto.randomUUID();
  }
}
