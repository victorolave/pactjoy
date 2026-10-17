import type { TodayView } from "@pactjoy/app";
import { ApiError } from "../ports/api-error.ts";
import type {
  AddCommitmentCommand,
  CircleInvite,
  CircleRef,
  CreateCircleCommand,
  CreateHabitCommand,
  CreateSeasonCommand,
  DismissNudgeCommand,
  EditCommitmentCommand,
  EditEntryCommand,
  EditSeasonCommand,
  InvitePreviewView,
  JoinCircleCommand,
  MyCircle,
  PactJoyApi,
  PauseDecision,
  PreviewScoringCommand,
  RecordEntryCommand,
  RecordedEntry,
  RequestPauseCommand,
  RequestPhotoUploadCommand,
  SendEncouragementCommand,
  SubmitClosureCommand,
  SubmitReviewCommand,
  UpdateHabitCommand,
} from "../ports/pactjoy-api.ts";
import type { SeasonProgressApi } from "../ports/season-progress-api.ts";
import type {
  CarryOverDto,
  CircleFeedDto,
  CommitmentStageDto,
  MyPauseRequests,
  PauseApprovalDto,
  PauseRequestDto,
  PhotoUploadDto,
  ProfileSummaryDto,
  ReactionCode,
  ReactionsDto,
  ReviewDraftDto,
  SeasonDto,
  SeasonHistoryDto,
  SeasonResultsDto,
  SubmittedClosureDto,
  SubmittedReviewDto,
} from "../ports/wire.ts";
import { FakeSeasonProgressApi } from "./fake-season-progress.ts";
import { NO_CIRCLE } from "./fixtures/circle.ts";
import {
  noPauseRequestsFixture,
  pauseApprovalFixture,
  pauseRequestFixture,
} from "./fixtures/pause.ts";
import { profileSummaryFixture } from "./fixtures/profile.ts";
import { carryOverFixture, seasonHistoryFixture } from "./fixtures/season-close.ts";
import { emptyFeedFixture } from "./fixtures/social.ts";

type ExistingMethod =
  | "getToday"
  | "recordEntry"
  | "editEntry"
  | "deleteEntry"
  | "requestPhotoUpload"
  | "getMyCircle"
  | "previewInvite"
  | "createCircle"
  | "joinCircle"
  | "generateInvite"
  | "renameCircle"
  | "renameMyDisplayName"
  | "leaveCircle"
  | "requestPause"
  | "getMyPauseRequests"
  | "respondToPause"
  | "cancelPauseRequest"
  | "resumePause"
  | "getReview"
  | "submitReview"
  | "skipBaseline"
  | "getCommitmentStage"
  | "getSeasonResults"
  | "submitSeasonClosure"
  | "getCarryOver"
  | "getSeasonHistory"
  | "getProfileSummary"
  | "feed"
  | "reactToFeedItem"
  | "removeFeedReaction"
  | "sendEncouragement"
  | "dismissNudge"
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
    requestPhotoUpload: 0,
    getMyCircle: 0,
    previewInvite: 0,
    createCircle: 0,
    joinCircle: 0,
    generateInvite: 0,
    renameCircle: 0,
    renameMyDisplayName: 0,
    leaveCircle: 0,
    requestPause: 0,
    getMyPauseRequests: 0,
    respondToPause: 0,
    cancelPauseRequest: 0,
    resumePause: 0,
    getReview: 0,
    submitReview: 0,
    skipBaseline: 0,
    getCommitmentStage: 0,
    getSeasonResults: 0,
    submitSeasonClosure: 0,
    getCarryOver: 0,
    getSeasonHistory: 0,
    getProfileSummary: 0,
    feed: 0,
    reactToFeedItem: 0,
    removeFeedReaction: 0,
    sendEncouragement: 0,
    dismissNudge: 0,
    getSeasonProgress: 0,
    getMemberProgress: 0,
    getCommitmentProgress: 0,
    getWeekSummary: 0,
  };
  /** Script the progress reads here; the four methods below delegate to it. */
  readonly progress = new FakeSeasonProgressApi();
  /** What the circle mutations were asked to do, in order, for assertions. */
  readonly circleCommands: { readonly method: Method; readonly args: readonly unknown[] }[] = [];
  /** What the pause mutations were asked to do, in order, including the ones scripted to fail. */
  readonly pauseCommands: { readonly method: Method; readonly args: readonly unknown[] }[] = [];
  /** What the review mutations were asked to do, in order, including the ones scripted to fail. */
  readonly reviewCommands: { readonly method: Method; readonly args: readonly unknown[] }[] = [];
  /** What the season closure was asked to do, in order, including the calls scripted to fail. */
  readonly closureCommands: { readonly seasonId: string; readonly cmd: SubmitClosureCommand }[] =
    [];
  /** What the social mutations were asked to do, in order, including the ones scripted to fail. */
  readonly socialCommands: { readonly method: Method; readonly args: readonly unknown[] }[] = [];
  /** Every recordEntry call, including the ones that were scripted to fail. */
  readonly recordAttempts: RecordEntryCommand[] = [];
  /** Every deleteEntry call, including the ones that were scripted to fail. */
  readonly deleteAttempts: string[] = [];
  readonly recorded: RecordEntryCommand[] = [];
  readonly edited: EditEntryCommand[] = [];
  readonly deleted: string[] = [];
  /** Every requestPhotoUpload call, including the ones that were scripted to fail. */
  readonly photoRequests: RequestPhotoUploadCommand[] = [];

  readonly pactCommands: { readonly method: PactMethod; readonly args: readonly unknown[] }[] = [];
  readonly #pactResults = new Map<PactMethod, unknown>([["listHabits", []]]);

  setPactResponse<K extends PactMethod>(method: K, value: PactResult<K>): void {
    this.#pactResults.set(method, value);
  }

  #today: TodayView;
  #myCircle: MyCircle = NO_CIRCLE;
  #myPauseRequests: MyPauseRequests = noPauseRequestsFixture();
  readonly #reviews = new Map<string, ReviewDraftDto>();
  readonly #stages = new Map<string, CommitmentStageDto>();
  readonly #seasonResults = new Map<string, SeasonResultsDto>();
  readonly #carryOvers = new Map<string, CarryOverDto>();
  #seasonHistory: SeasonHistoryDto = seasonHistoryFixture();
  #profileSummary: ProfileSummaryDto = profileSummaryFixture();
  #feedPages: CircleFeedDto[] = [emptyFeedFixture()];
  #closureResult: SubmittedClosureDto | null = null;
  #submitResult: SubmittedReviewDto = {
    status: "completed",
    improvements: [],
    nextReviewDate: null,
  };
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

  setMyPauseRequests(view: MyPauseRequests): void {
    this.#myPauseRequests = view;
  }

  /** The draft `getReview` answers for one period (0 is the baseline). */
  setReview(seasonId: string, periodIndex: number, draft: ReviewDraftDto): void {
    this.#reviews.set(`${seasonId}:${periodIndex}`, draft);
  }

  setSubmitResult(result: SubmittedReviewDto): void {
    this.#submitResult = result;
  }

  /** The results `getSeasonResults` answers for a season. */
  setSeasonResults(results: SeasonResultsDto): void {
    this.#seasonResults.set(results.seasonId, results);
  }

  setCarryOver(seasonId: string, view: CarryOverDto): void {
    this.#carryOvers.set(seasonId, view);
  }

  setSeasonHistory(view: SeasonHistoryDto): void {
    this.#seasonHistory = view;
  }

  setProfileSummary(view: ProfileSummaryDto): void {
    this.#profileSummary = view;
  }

  /**
   * The feed pages `feed` serves: the first without a cursor, the rest by the `page-N` cursors the
   * fake hands out. Cursors are assigned here, and only the first page keeps its nudge.
   */
  setFeedPages(pages: readonly CircleFeedDto[]): void {
    this.#feedPages = pages.map((page, index) => ({
      ...page,
      nextCursor: index < pages.length - 1 ? `page-${index + 1}` : null,
      nudge: index === 0 ? page.nudge : null,
    }));
  }

  /** What `submitSeasonClosure` answers; by default it echoes the decisions it was given. */
  setClosureResult(result: SubmittedClosureDto): void {
    this.#closureResult = result;
  }

  setStage(stage: CommitmentStageDto): void {
    this.#stages.set(stage.commitmentId, stage);
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

  async requestPhotoUpload(cmd: RequestPhotoUploadCommand): Promise<PhotoUploadDto> {
    const gate = this.#takeGate("requestPhotoUpload");
    this.photoRequests.push(cmd);
    this.#enter("requestPhotoUpload");
    await gate;
    const photoId = `photo-${this.photoRequests.length}`;
    return {
      photoId,
      upload: {
        method: "PUT",
        url: `https://storage.test/entry-photos/${photoId}`,
        headers: { "content-type": "image/jpeg" },
        expiresAt: "2026-10-03T12:05:00.000Z",
      },
      attachBy: "2026-10-03T12:30:00.000Z",
    };
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

  async requestPause(seasonId: string, cmd: RequestPauseCommand): Promise<PauseRequestDto> {
    await this.#pauseCall("requestPause", [seasonId, cmd]);
    return pauseRequestFixture({
      endDate: cmd.endDate,
      startDate: cmd.startDate,
      reason: cmd.reason,
    });
  }

  async getMyPauseRequests(_signal?: AbortSignal): Promise<MyPauseRequests> {
    this.#enter("getMyPauseRequests");
    return this.#myPauseRequests;
  }

  async respondToPause(pauseRequestId: string, decision: PauseDecision): Promise<PauseApprovalDto> {
    await this.#pauseCall("respondToPause", [pauseRequestId, decision]);
    // Like the server: the answer stands, so the next read of the pending request shows it.
    this.#myPauseRequests = {
      ...this.#myPauseRequests,
      awaitingMe: this.#myPauseRequests.awaitingMe.map((item) =>
        item.id === pauseRequestId ? { ...item, myResponse: decision } : item,
      ),
    };
    return pauseApprovalFixture({ id: pauseRequestId, myResponse: decision });
  }

  async cancelPauseRequest(pauseRequestId: string): Promise<PauseRequestDto> {
    await this.#pauseCall("cancelPauseRequest", [pauseRequestId]);
    // Like the server: a cancelled request stays in my list, no longer pending.
    this.#myPauseRequests = {
      ...this.#myPauseRequests,
      mine: this.#myPauseRequests.mine.map((item) =>
        item.id === pauseRequestId ? { ...item, status: "cancelled" } : item,
      ),
    };
    return pauseRequestFixture({ id: pauseRequestId, status: "cancelled" });
  }

  async resumePause(pauseRequestId: string, commitmentId?: string): Promise<PauseRequestDto> {
    await this.#pauseCall(
      "resumePause",
      commitmentId === undefined ? [pauseRequestId] : [pauseRequestId, commitmentId],
    );
    return pauseRequestFixture({ id: pauseRequestId, status: "approved" });
  }

  async getReview(seasonId: string, periodIndex: number, _signal?: AbortSignal) {
    this.#enter("getReview");
    const draft = this.#reviews.get(`${seasonId}:${periodIndex}`);
    if (draft === undefined) throw new ApiError("ReviewPeriodNotFound", 404, null);
    return draft;
  }

  async submitReview(seasonId: string, periodIndex: number, cmd: SubmitReviewCommand) {
    await this.#reviewCall("submitReview", [seasonId, periodIndex, cmd]);
    this.#markReview(seasonId, periodIndex, "completed");
    this.#clearReviewOffer();
    return this.#submitResult;
  }

  async skipBaseline(seasonId: string): Promise<void> {
    await this.#reviewCall("skipBaseline", [seasonId]);
    this.#markReview(seasonId, 0, "skipped");
    this.#clearReviewOffer();
  }

  async getCommitmentStage(_seasonId: string, commitmentId: string, _signal?: AbortSignal) {
    this.#enter("getCommitmentStage");
    return this.#stages.get(commitmentId) ?? { commitmentId, stage: "new" as const };
  }

  async getSeasonResults(seasonId: string, _signal?: AbortSignal) {
    this.#enter("getSeasonResults");
    const results = this.#seasonResults.get(seasonId);
    if (results === undefined) throw new ApiError("SeasonNotFound", 404, null);
    return results;
  }

  async submitSeasonClosure(seasonId: string, cmd: SubmitClosureCommand) {
    const gate = this.#takeGate("submitSeasonClosure");
    this.closureCommands.push({ seasonId, cmd });
    this.#enter("submitSeasonClosure");
    await gate;
    const result: SubmittedClosureDto = this.#closureResult ?? {
      decidedAt: "2026-10-21T15:00:00.000Z",
      decisions: cmd.decisions,
      graduatedHabitIds: [],
      seasonClosed: false,
    };
    // Like the server: a closure is insert-once, so reading the results again shows it stored.
    const results = this.#seasonResults.get(seasonId);
    if (results !== undefined) {
      this.#seasonResults.set(seasonId, {
        ...results,
        closure: { decidedAt: result.decidedAt, decisions: result.decisions },
      });
    }
    return result;
  }

  async getCarryOver(seasonId: string, _signal?: AbortSignal) {
    this.#enter("getCarryOver");
    return this.#carryOvers.get(seasonId) ?? carryOverFixture();
  }

  async getSeasonHistory(_signal?: AbortSignal) {
    this.#enter("getSeasonHistory");
    return this.#seasonHistory;
  }

  async getProfileSummary(_signal?: AbortSignal) {
    this.#enter("getProfileSummary");
    return this.#profileSummary;
  }

  async feed(cursor?: string | null, _signal?: AbortSignal): Promise<CircleFeedDto> {
    this.#enter("feed");
    if (cursor === undefined || cursor === null) return this.#feedPages[0] ?? emptyFeedFixture();
    const index = /^page-(\d+)$/.test(cursor) ? Number(cursor.slice("page-".length)) : -1;
    const page = index >= 1 ? this.#feedPages[index] : undefined;
    if (page === undefined) throw new ApiError("InvalidFeedCursor", 422, null);
    return page;
  }

  async reactToFeedItem(seasonId: string, itemKey: string, emoji: ReactionCode) {
    await this.#socialCall("reactToFeedItem", [seasonId, itemKey, emoji]);
    return this.#react(itemKey, emoji);
  }

  async removeFeedReaction(seasonId: string, itemKey: string) {
    await this.#socialCall("removeFeedReaction", [seasonId, itemKey]);
    return this.#react(itemKey, null);
  }

  async sendEncouragement(seasonId: string, cmd: SendEncouragementCommand): Promise<void> {
    await this.#socialCall("sendEncouragement", [seasonId, cmd]);
    this.#clearNudge();
  }

  async dismissNudge(seasonId: string, cmd: DismissNudgeCommand): Promise<void> {
    await this.#socialCall("dismissNudge", [seasonId, cmd]);
    this.#clearNudge();
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

  /** Records the call, waits on a held gate, then throws a scripted failure. */
  async #pauseCall(method: Method, args: readonly unknown[]): Promise<void> {
    const gate = this.#takeGate(method);
    this.pauseCommands.push({ method, args });
    this.#enter(method);
    await gate;
  }

  /** Records the call, waits on a held gate, then throws a scripted failure. */
  async #reviewCall(method: Method, args: readonly unknown[]): Promise<void> {
    const gate = this.#takeGate(method);
    this.reviewCommands.push({ method, args });
    this.#enter(method);
    await gate;
  }

  /**
   * Records the call, waits on a held gate, THEN counts it and throws a scripted failure: a held
   * call can fail after the screen has already shown its optimistic state.
   */
  async #socialCall(method: Method, args: readonly unknown[]): Promise<void> {
    const gate = this.#takeGate(method);
    this.socialCommands.push({ method, args });
    await gate;
    this.#enter(method);
  }

  /**
   * Like the server: one reaction per member per item, counts only. `code` null takes it back.
   * The stored item changes too, so the next read of the feed shows it.
   */
  #react(itemKey: string, code: ReactionCode | null): ReactionsDto {
    for (const [pageIndex, page] of this.#feedPages.entries()) {
      const at = page.items.findIndex((item) => item.key === itemKey);
      const found = page.items[at];
      if (found === undefined) continue;
      if (!("reactions" in found) || !found.reactions.reactable) {
        throw new ApiError("FeedItemNotReactable", 409, null);
      }
      const { counts, mine } = found.reactions;
      const next = { ...counts };
      if (mine !== null) next[mine] -= 1;
      if (code !== null) next[code] += 1;
      const reactions: ReactionsDto = { counts: next, mine: code, reactable: true };
      const items = page.items.map((item, index) => (index === at ? { ...item, reactions } : item));
      this.#feedPages[pageIndex] = { ...page, items: items as CircleFeedDto["items"] };
      return reactions;
    }
    throw new ApiError("FeedItemNotFound", 404, null);
  }

  /** Like the server: a sent or dismissed case is no longer offered. */
  #clearNudge(): void {
    const first = this.#feedPages[0];
    if (first !== undefined) this.#feedPages[0] = { ...first, nudge: null };
  }

  /** Like the server: reading a saved review afterwards says it is saved, not due. */
  #markReview(seasonId: string, periodIndex: number, status: "completed" | "skipped"): void {
    const key = `${seasonId}:${periodIndex}`;
    const draft = this.#reviews.get(key);
    if (draft !== undefined) this.#reviews.set(key, { ...draft, status });
  }

  /** Like the server: a saved or skipped review is no longer pending, so the next Today has none. */
  #clearReviewOffer(): void {
    if ("pendingReview" in this.#today) {
      this.#today = { ...this.#today, pendingReview: null, baselineOffer: null };
    }
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
