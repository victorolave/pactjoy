import type { ApiError } from "../ports/api-error.ts";
import type { SeasonProgressApi } from "../ports/season-progress-api.ts";
import type {
  CommitmentProgress,
  MemberProgress,
  SeasonProgress,
  WeekSummary,
} from "../ports/wire.ts";

type Method = keyof SeasonProgressApi;
type Key = readonly (string | number)[];

/**
 * In-memory SeasonProgressApi for tests. Responses are scripted per method AND arguments; an
 * unscripted read rejects instead of inventing data. Failures queue and calls can be held, like
 * `FakePactJoyApi`. It never scores: the views are returned exactly as scripted.
 */
export class FakeSeasonProgressApi implements SeasonProgressApi {
  readonly calls: Record<Method, number> = {
    getSeasonProgress: 0,
    getMemberProgress: 0,
    getCommitmentProgress: 0,
    getWeekSummary: 0,
  };
  readonly commands: { readonly method: Method; readonly args: Key }[] = [];
  readonly #responses = new Map<string, unknown>();
  readonly #failures = new Map<Method, ApiError[]>();
  readonly #gates = new Map<Method, Promise<void>>();

  setSeasonProgress(seasonId: string, view: SeasonProgress): void {
    this.#script("getSeasonProgress", [seasonId], view);
  }
  setMemberProgress(seasonId: string, memberId: string, view: MemberProgress): void {
    this.#script("getMemberProgress", [seasonId, memberId], view);
  }
  setCommitmentProgress(seasonId: string, commitmentId: string, view: CommitmentProgress): void {
    this.#script("getCommitmentProgress", [seasonId, commitmentId], view);
  }
  setWeekSummary(seasonId: string, weekIndex: number, view: WeekSummary): void {
    this.#script("getWeekSummary", [seasonId, weekIndex], view);
  }

  /** The next call to `method` rejects with `error` (queued: call twice to fail twice). */
  failNext(method: Method, error: ApiError): void {
    this.#failures.set(method, [...(this.#failures.get(method) ?? []), error]);
  }

  /** The next call to `method` waits until the returned function is called. */
  hold(method: Method): () => void {
    let release = () => {};
    this.#gates.set(method, new Promise<void>((resolve) => (release = resolve)));
    return release;
  }

  getSeasonProgress(seasonId: string, _signal?: AbortSignal) {
    return this.#call<SeasonProgress>("getSeasonProgress", [seasonId]);
  }
  getMemberProgress(seasonId: string, memberId: string, _signal?: AbortSignal) {
    return this.#call<MemberProgress>("getMemberProgress", [seasonId, memberId]);
  }
  getCommitmentProgress(seasonId: string, commitmentId: string, _signal?: AbortSignal) {
    return this.#call<CommitmentProgress>("getCommitmentProgress", [seasonId, commitmentId]);
  }
  getWeekSummary(seasonId: string, weekIndex: number, _signal?: AbortSignal) {
    return this.#call<WeekSummary>("getWeekSummary", [seasonId, weekIndex]);
  }

  #script(method: Method, args: Key, view: unknown): void {
    this.#responses.set(JSON.stringify([method, ...args]), view);
  }

  async #call<T>(method: Method, args: Key): Promise<T> {
    const gate = this.#gates.get(method);
    this.#gates.delete(method);
    this.commands.push({ method, args });
    this.calls[method] += 1;
    const failure = this.#failures.get(method)?.shift();
    if (failure !== undefined) throw failure;
    await gate;
    const key = JSON.stringify([method, ...args]);
    if (!this.#responses.has(key)) throw new Error(`No response scripted for ${method}(${args})`);
    return this.#responses.get(key) as T;
  }
}
