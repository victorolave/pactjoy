import type { TodayView } from "@pactjoy/app";
import type { ApiError } from "../ports/api-error.ts";
import type {
  EditEntryCommand,
  PactJoyApi,
  RecordEntryCommand,
  RecordedEntry,
} from "../ports/pactjoy-api.ts";

type Method = "getToday" | "recordEntry" | "editEntry" | "deleteEntry";

/**
 * In-memory PactJoyApi for tests, scriptable per state and per error. `recordEntry` is idempotent
 * on `clientRequestId` like the real API: a repeat returns the same entryId with `replayed: true`.
 */
export class FakePactJoyApi implements PactJoyApi {
  readonly calls: Record<Method, number> = {
    getToday: 0,
    recordEntry: 0,
    editEntry: 0,
    deleteEntry: 0,
  };
  /** Every recordEntry call, including the ones that were scripted to fail. */
  readonly recordAttempts: RecordEntryCommand[] = [];
  /** Every deleteEntry call, including the ones that were scripted to fail. */
  readonly deleteAttempts: string[] = [];
  readonly recorded: RecordEntryCommand[] = [];
  readonly edited: EditEntryCommand[] = [];
  readonly deleted: string[] = [];

  #today: TodayView;
  readonly #failures = new Map<Method, ApiError[]>();
  readonly #idByRequest = new Map<string, string>();
  readonly #gates = new Map<Method, Promise<void>>();

  constructor(today: TodayView) {
    this.#today = today;
  }

  setToday(today: TodayView): void {
    this.#today = today;
  }

  /** The next call to `method` rejects with `error` (queued: call twice to fail twice). */
  failNext(method: Method, error: ApiError): void {
    this.#failures.set(method, [...(this.#failures.get(method) ?? []), error]);
  }

  /** The next call to `method` waits until the returned function is called (to test pending UI). */
  hold(method: Method): () => void {
    let release = () => {};
    this.#gates.set(
      method,
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    return release;
  }

  async getToday(_signal?: AbortSignal): Promise<TodayView> {
    this.#enter("getToday");
    return this.#today;
  }

  async recordEntry(cmd: RecordEntryCommand): Promise<RecordedEntry> {
    const gate = this.#takeGate("recordEntry");
    this.recordAttempts.push(cmd);
    this.#enter("recordEntry");
    await gate;
    this.recorded.push(cmd);
    const existing = this.#idByRequest.get(cmd.clientRequestId);
    if (existing !== undefined) return { entryId: existing, replayed: true };
    const entryId = `entry-${this.#idByRequest.size + 1}`;
    this.#idByRequest.set(cmd.clientRequestId, entryId);
    return { entryId, replayed: false };
  }

  async editEntry(cmd: EditEntryCommand): Promise<void> {
    this.#enter("editEntry");
    this.edited.push(cmd);
  }

  async deleteEntry(entryId: string): Promise<void> {
    this.deleteAttempts.push(entryId);
    this.#enter("deleteEntry");
    this.deleted.push(entryId);
  }

  #takeGate(method: Method): Promise<void> | undefined {
    const gate = this.#gates.get(method);
    this.#gates.delete(method);
    return gate;
  }

  #enter(method: Method): void {
    this.calls[method] += 1;
    const failure = this.#failures.get(method)?.shift();
    if (failure !== undefined) throw failure;
  }
}
