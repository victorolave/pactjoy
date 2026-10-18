import type { NamedCommitment, ReminderNamesPort } from "../ports/reminder-names.ts";
import { decodeReminderNames, encodeReminderNames } from "../sw/reminder-names.ts";

/** Records what the app leaves on the device for reminder pushes, as the worker would read it. */
export class FakeReminderNames implements ReminderNamesPort {
  /** Every save, in order. */
  readonly saves: (readonly NamedCommitment[])[] = [];
  clears = 0;
  #stored: string | null = null;

  async save(commitments: readonly NamedCommitment[]): Promise<void> {
    this.saves.push(commitments);
    this.#stored = encodeReminderNames(commitments);
  }

  async clear(): Promise<void> {
    this.clears += 1;
    this.#stored = null;
  }

  /** What the service worker would find now. */
  current(): ReadonlyMap<string, string> {
    return decodeReminderNames(this.#stored);
  }
}
