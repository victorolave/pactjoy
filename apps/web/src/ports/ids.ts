export interface IdSource {
  /** A fresh UUID. */
  newId(): string;
}
