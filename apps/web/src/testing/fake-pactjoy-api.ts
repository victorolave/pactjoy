import type { TodayView } from "@pactjoy/app";
import { ApiError } from "../ports/api-error.ts";
import type {
  AddCommitmentCommand,
  CircleInvite,
  CircleRef,
  CreateCircleCommand,
  CreateHabitCommand,
  CreateSeasonCommand,
  EditCommitmentCommand,
  EditEntryCommand,
  EditSeasonCommand,
  InvitePreviewView,
  JoinCircleCommand,
  MyCircle,
  PactJoyApi,
  PreviewScoringCommand,
  RecordEntryCommand,
  RecordedEntry,
  UpdateHabitCommand,
} from "../ports/pactjoy-api.ts";
import type { SeasonProgressApi } from "../ports/season-progress-api.ts";
import type { SeasonDto } from "../ports/wire.ts";
import { FakeSeasonProgressApi } from "./fake-season-progress.ts";
import { NO_CIRCLE } from "./fixtures/circle.ts";

type ExistingMethod =
  | "getToday"
  | "recordEntry"
  | "editEntry"
  | "deleteEntry"
  | "getMyCircle"
  | "previewInvite"
  | "createCircle"
  | "joinCircle"
  | "generateInvite"
  | "renameCircle"
  | "renameMyDisplayName"
  | "leaveCircle"
  | ProgressMethod;
type ProgressMethod = keyof SeasonProgressApi;

type Method = keyof PactJoyApi;
type PactMethod = Exclude<Method, ExistingMethod>;
type PactResult<K extends PactMethod> = Awaited<ReturnType<PactJoyApi[K]>>;

const INVITE: CircleInvite = {
  code: "7K4Q2M",
  createdAt: "2026-10-01T12:00:00.000Z",
  expiresAt: "2026-10-08T12:00:00.000Z",
};
const PREVIEW: InvitePreviewView = {
  circleName: "Los Pactos",
  invitedBy: "Andrea",
  activeMemberCount: 2,
  expiresAt: "2026-10-08T12:00:00.000Z",
};

/**
 * In-memory PactJoyApi for tests, scriptable per state and per error. `recordEntry` is idempotent
 * on `clientRequestId` like the real API: a repeat returns the same entryId with `replayed: true`.
 */
export class FakePactJoyApi implements PactJoyApi {
  readonly calls: Record<Method, number> = {
    listHabits: 0,
    createHabit: 0,
    updateHabit: 0,
    createSeason: 0,
    editSeason: 0,
    getSeason: 0,
    addCommitment: 0,
    editCommitment: 0,
    removeCommitment: 0,
    approvePact: 0,
    withdrawApproval: 0,
    previewScoring: 0,
    getToday: 0,
    recordEntry: 0,
    editEntry: 0,
    deleteEntry: 0,
    getMyCircle: 0,
    previewInvite: 0,
    createCircle: 0,
    joinCircle: 0,
    generateInvite: 0,
    renameCircle: 0,
    renameMyDisplayName: 0,
    leaveCircle: 0,
    getSeasonProgress: 0,
    getMemberProgress: 0,
    getCommitmentProgress: 0,
    getWeekSummary: 0,
  };
  /** Script the progress reads here; the four methods below delegate to it. */
  readonly progress = new FakeSeasonProgressApi();
  /** What the circle mutations were asked to do, in order, for assertions. */
  readonly circleCommands: { readonly method: Method; readonly args: readonly unknown[] }[] = [];
  /** Every recordEntry call, including the ones that were scripted to fail. */
  readonly recordAttempts: RecordEntryCommand[] = [];
  /** Every deleteEntry call, including the ones that were scripted to fail. */
  readonly deleteAttempts: string[] = [];
  readonly recorded: RecordEntryCommand[] = [];
  readonly edited: EditEntryCommand[] = [];
  readonly deleted: string[] = [];

  readonly pactCommands: { readonly method: PactMethod; readonly args: readonly unknown[] }[] = [];
  readonly #pactResults = new Map<PactMethod, unknown>([["listHabits", []]]);

  setPactResponse<K extends PactMethod>(method: K, value: PactResult<K>): void {
    this.#pactResults.set(method, value);
  }

  #today: TodayView;
  #myCircle: MyCircle = NO_CIRCLE;
  #preview: InvitePreviewView = PREVIEW;
  #invite: CircleInvite = INVITE;
  readonly #failures = new Map<Method, ApiError[]>();
  readonly #idByRequest = new Map<string, string>();
  readonly #gates = new Map<Method, Promise<void>>();
  #editingCommitment = false;

  constructor(today: TodayView) {
    this.#today = today;
  }

  setToday(today: TodayView): void {
    this.#today = today;
  }

  setMyCircle(myCircle: MyCircle): void {
    this.#myCircle = myCircle;
  }

  setPreview(preview: InvitePreviewView): void {
    this.#preview = preview;
  }

  setInvite(invite: CircleInvite): void {
    this.#invite = invite;
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

  async listHabits(_signal?: AbortSignal) {
    return this.#pactCall("listHabits", []);
  }
  async createHabit(input: CreateHabitCommand) {
    return this.#pactCall("createHabit", [input]);
  }
  async updateHabit(id: string, patch: UpdateHabitCommand) {
    return this.#pactCall("updateHabit", [id, patch]);
  }
  async createSeason(circleId: string, input: CreateSeasonCommand) {
    return this.#pactCall("createSeason", [circleId, input]);
  }
  async editSeason(seasonId: string, input: EditSeasonCommand) {
    return this.#pactCall("editSeason", [seasonId, input]);
  }
  async getSeason(seasonId: string, _signal?: AbortSignal) {
    return this.#pactCall("getSeason", [seasonId]);
  }
  async addCommitment(seasonId: string, input: AddCommitmentCommand) {
    return this.#pactCall("addCommitment", [seasonId, input]);
  }
  async editCommitment(seasonId: string, commitmentId: string, input: EditCommitmentCommand) {
    if (this.#editingCommitment) {
      throw new ApiError("ConcurrencyConflict", 409, null);
    }
    this.#editingCommitment = true;
    try {
      await Promise.resolve();
      const currentSeason = this.#pactResults.get("getSeason") as SeasonDto | undefined;
      const calculatedSeason = currentSeason
        ? {
            ...currentSeason,
            version: currentSeason.version + 1,
            commitments: currentSeason.commitments.map((c) =>
              c.id === commitmentId ? { ...c, weightPercent: input.weightPercent } : c,
            ),
          }
        : undefined;

      if (!this.#pactResults.has("editCommitment") && calculatedSeason) {
        this.#pactResults.set("editCommitment", calculatedSeason);
      }

      const res = await this.#pactCall("editCommitment", [seasonId, commitmentId, input]);

      const updatedSeason = calculatedSeason ?? (res as SeasonDto);
      if (calculatedSeason) {
        this.#pactResults.set("getSeason", updatedSeason);
      }
      return updatedSeason;
    } finally {
      this.#editingCommitment = false;
    }
  }
  async removeCommitment(seasonId: string, commitmentId: string) {
    return this.#pactCall("removeCommitment", [seasonId, commitmentId]);
  }
  async approvePact(seasonId: string, expectedPactRevision: number) {
    const res = await this.#pactCall("approvePact", [seasonId, expectedPactRevision]);
    this.#pactResults.set("getSeason", res);
    return res;
  }
  async withdrawApproval(seasonId: string) {
    const res = await this.#pactCall("withdrawApproval", [seasonId]);
    this.#pactResults.set("getSeason", res);
    return res;
  }
  async previewScoring(input: PreviewScoringCommand, _signal?: AbortSignal) {
    return this.#pactCall("previewScoring", [input]);
  }

  /** Script wire responses, not scoring or pact business rules. */
  async #pactCall<K extends PactMethod>(
    method: K,
    args: readonly unknown[],
  ): Promise<PactResult<K>> {
    const gate = this.#takeGate(method);
    this.pactCommands.push({ method, args });
    this.#enter(method);
    await gate;
    if (!this.#pactResults.has(method)) throw new Error(`No pact response scripted for ${method}`);
    return this.#pactResults.get(method) as PactResult<K>;
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

  async getMyCircle(_signal?: AbortSignal): Promise<MyCircle> {
    await this.#circleCall("getMyCircle", []);
    return this.#myCircle;
  }

  async previewInvite(inviteCode: string, _signal?: AbortSignal): Promise<InvitePreviewView> {
    await this.#circleCall("previewInvite", [inviteCode]);
    return this.#preview;
  }

  async createCircle(cmd: CreateCircleCommand): Promise<CircleRef> {
    await this.#circleCall("createCircle", [cmd]);
    return { circleId: "circle-1" };
  }

  async joinCircle(cmd: JoinCircleCommand): Promise<CircleRef> {
    await this.#circleCall("joinCircle", [cmd]);
    return { circleId: "circle-1" };
  }

  async generateInvite(circleId: string): Promise<CircleInvite> {
    await this.#circleCall("generateInvite", [circleId]);
    return this.#invite;
  }

  async renameCircle(circleId: string, name: string): Promise<void> {
    await this.#circleCall("renameCircle", [circleId, name]);
  }

  async renameMyDisplayName(circleId: string, displayName: string): Promise<void> {
    await this.#circleCall("renameMyDisplayName", [circleId, displayName]);
  }

  async leaveCircle(circleId: string): Promise<void> {
    await this.#circleCall("leaveCircle", [circleId]);
    // Like the server: the viewer has no circle from now on.
    this.#myCircle = { circle: null, season: null };
  }

  async getSeasonProgress(seasonId: string, signal?: AbortSignal) {
    this.#enter("getSeasonProgress");
    return this.progress.getSeasonProgress(seasonId, signal);
  }

  async getMemberProgress(seasonId: string, memberId: string, signal?: AbortSignal) {
    this.#enter("getMemberProgress");
    return this.progress.getMemberProgress(seasonId, memberId, signal);
  }

  async getCommitmentProgress(seasonId: string, commitmentId: string, signal?: AbortSignal) {
    this.#enter("getCommitmentProgress");
    return this.progress.getCommitmentProgress(seasonId, commitmentId, signal);
  }

  async getWeekSummary(seasonId: string, weekIndex: number, signal?: AbortSignal) {
    this.#enter("getWeekSummary");
    return this.progress.getWeekSummary(seasonId, weekIndex, signal);
  }

  /** Records the call, waits on a held gate, then throws a scripted failure. */
  async #circleCall(method: Method, args: readonly unknown[]): Promise<void> {
    const gate = this.#takeGate(method);
    this.circleCommands.push({ method, args });
    this.#enter(method);
    await gate;
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
