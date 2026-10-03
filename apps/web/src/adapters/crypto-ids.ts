import type { IdSource } from "../ports/ids.ts";

/** The part of Web Crypto the ids need. `randomUUID` exists only on secure origins. */
export type RandomSource = {
  getRandomValues(array: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer>;
  randomUUID?: () => string;
};

export class CryptoIds implements IdSource {
  readonly #source: RandomSource;

  constructor(source: RandomSource = crypto) {
    this.#source = source;
  }

  newId(): string {
    if (typeof this.#source.randomUUID === "function") {
      return this.#source.randomUUID();
    }
    return uuidV4From(this.#source);
  }
}

/** RFC 9562 version 4 UUID from 16 random bytes. */
function uuidV4From(source: RandomSource): string {
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
