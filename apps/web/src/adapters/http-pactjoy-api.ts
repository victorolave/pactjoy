import type { TodayView } from "@pactjoy/app";
import { ApiError } from "../ports/api-error.ts";
import type { RefreshResult } from "../ports/auth.ts";
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
  PushConfigDto,
  RecordEntryCommand,
  RecordedEntry,
  RequestPauseCommand,
  RequestPhotoUploadCommand,
  ScoringPreview,
  SendEncouragementCommand,
  SubmitClosureCommand,
  SubmitReviewCommand,
  UpdateHabitCommand,
} from "../ports/pactjoy-api.ts";
import type { DevicePushSubscription } from "../ports/push-subscription.ts";
import type {
  CarryOverDto,
  CircleFeedDto,
  CommitmentProgress,
  CommitmentReminderDto,
  CommitmentStageDto,
  HabitDto,
  MemberProgress,
  MyPauseRequests,
  PauseApprovalDto,
  PauseRequestDto,
  PhotoUploadDto,
  ProfileSummaryDto,
  ReactionCode,
  ReactionsDto,
  ReminderSettingCommand,
  ReviewDraftDto,
  SeasonDto,
  SeasonHistoryDto,
  SeasonProgress,
  SeasonResultsDto,
  SubmittedClosureDto,
  SubmittedReviewDto,
  WeekSummary,
} from "../ports/wire.ts";
import { progressApiPaths } from "../shared/season-progress-routes.ts";
import { isMyPauseRequests, isPauseApproval, isPauseRequest } from "./pause-guards.ts";
import { isPhotoUpload } from "./photo-guards.ts";
import { isProfileSummary } from "./profile-guards.ts";
import {
  isCommitmentStage,
  isReviewDraft,
  isSkippedBaseline,
  isSubmittedReview,
} from "./review-guards.ts";
import {
  isCarryOver,
  isSeasonHistory,
  isSeasonResults,
  isSubmittedClosure,
} from "./season-close-guards.ts";
import {
  isCommitmentProgress,
  isMemberProgress,
  isSeasonProgress,
  isWeekSummary,
} from "./season-progress-guards.ts";
import { isCircleFeed, isReactions, isSentEncouragement } from "./social-guards.ts";

/** `{vapidPublicKey: string | null}` and nothing else (ADR-0017). */
const isPushConfig = (data: unknown): data is PushConfigDto =>
  typeof data === "object" &&
  data !== null &&
  Object.keys(data).length === 1 &&
  "vapidPublicKey" in data &&
  (data.vapidPublicKey === null || typeof data.vapidPublicKey === "string");

const isWeekdays = (value: unknown): value is readonly number[] =>
  Array.isArray(value) &&
  value.length <= 7 &&
  value.every((day) => Number.isInteger(day) && day >= 0 && day <= 6);

/** The owner's reminder setting (ADR-0017 addendum, D2), every field checked. */
const isCommitmentReminder = (data: unknown): data is CommitmentReminderDto => {
  if (typeof data !== "object" || data === null) return false;
  const r = data as Record<string, unknown>;
  return (
    typeof r.commitmentId === "string" &&
    typeof r.enabled === "boolean" &&
    Number.isInteger(r.minuteOfDay) &&
    isWeekdays(r.weekdays) &&
    isWeekdays(r.availableWeekdays)
  );
};

export interface HttpPactJoyApiOptions {
  readonly baseUrl: string;
  /** The current access token, refreshed ahead of expiry by the session manager. */
  readonly getAccessToken: () => Promise<string | null>;
  /** Forces a refresh after a 401. `transient` keeps the session; `rejected` ends it. */
  readonly refreshAccessToken: () => Promise<RefreshResult>;
  /** Called once when a request is still unauthorized after the refresh attempt. */
  readonly onUnauthorized: () => void;
  readonly fetch: typeof fetch;
}

interface HttpRequest {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal | undefined;
  /** Shape check for the 2xx `data`; a failure becomes ApiError("Internal"). Omitted = anything. */
  readonly valid?: (data: unknown) => boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isRecordResult = (data: unknown): boolean =>
  isRecord(data) &&
  isRecord(data.entry) &&
  typeof data.entry.id === "string" &&
  typeof data.replayed === "boolean";

const isTodayView = (data: unknown): boolean => isRecord(data) && typeof data.state === "string";

const isMyCircle = (data: unknown): boolean =>
  isRecord(data) && "circle" in data && "season" in data;

const isCircleRef = (data: unknown): boolean => isRecord(data) && typeof data.id === "string";

const isInvite = (data: unknown): boolean =>
  isRecord(data) && typeof data.code === "string" && typeof data.expiresAt === "string";

const isPreview = (data: unknown): boolean =>
  isRecord(data) && typeof data.circleName === "string" && typeof data.expiresAt === "string";

const seasonPath = (id: string): string => `/seasons/${encodeURIComponent(id)}`;
const commitmentPath = (sid: string, cid: string): string =>
  `${seasonPath(sid)}/commitments/${encodeURIComponent(cid)}`;
/** Required fields only: enough to reject a wrong or truncated body, not a full schema check. */
const isHabitDto = (data: unknown): boolean =>
  isRecord(data) &&
  typeof data.id === "string" &&
  typeof data.name === "string" &&
  (data.icon === null || typeof data.icon === "string") &&
  (data.graduatedAt === null || typeof data.graduatedAt === "string") &&
  typeof data.version === "number";
const isHabitList = (data: unknown): boolean =>
  isRecord(data) && Array.isArray(data.habits) && data.habits.every(isHabitDto);
const isSeasonDto = (data: unknown): boolean =>
  isRecord(data) &&
  typeof data.id === "string" &&
  typeof data.status === "string" &&
  Array.isArray(data.commitments) &&
  Array.isArray(data.approvals) &&
  typeof data.pactRevision === "number" &&
  typeof data.version === "number";
const isScoringPreview = (data: unknown): boolean =>
  isRecord(data) &&
  Array.isArray(data.rows) &&
  data.rows.every(
    (row: unknown) =>
      isRecord(row) &&
      typeof row.value === "string" &&
      typeof row.progressPercent === "string" &&
      /^(?:100|\d{1,2})$/.test(row.progressPercent),
  );

const reviewPath = (seasonId: string, periodIndex: number): string =>
  `${seasonPath(seasonId)}/reviews/${periodIndex}`;

const pausePath = (id: string): string => `/pause-requests/${encodeURIComponent(id)}`;

/** The item key carries ":" (`session:<id>:<day>`); it travels as one encoded path segment. */
const reactionPath = (seasonId: string, itemKey: string): string =>
  `${seasonPath(seasonId)}/feed/${encodeURIComponent(itemKey)}/reaction`;

const circlePath = (circleId: string): string => `/circles/${encodeURIComponent(circleId)}`;

/** Maps a failed response to an ApiError. Without a usable envelope the status decides. */
async function toApiError(response: Response): Promise<ApiError> {
  const requestId = response.headers.get("X-Request-Id");
  const parsed: unknown = await response.json().catch(() => null);
  const envelope = isRecord(parsed) ? parsed.error : undefined;
  if (isRecord(envelope) && typeof envelope.code === "string") {
    const details = isRecord(envelope.details) ? envelope.details : undefined;
    return new ApiError(envelope.code, response.status, requestId, details);
  }
  if (response.status === 401) return new ApiError("Unauthorized", 401, requestId);
  const code = response.status === 503 ? "ServiceUnavailable" : "Internal";
  return new ApiError(code, response.status, requestId);
}

export class HttpPactJoyApi implements PactJoyApi {
  readonly #options: HttpPactJoyApiOptions;

  constructor(options: HttpPactJoyApiOptions) {
    this.#options = options;
  }

  async listHabits(signal?: AbortSignal): Promise<readonly HabitDto[]> {
    const data = await this.#request({
      method: "GET",
      path: "/habits",
      signal,
      valid: isHabitList,
    });
    return (data as { habits: readonly HabitDto[] }).habits;
  }

  async createHabit(input: CreateHabitCommand): Promise<HabitDto> {
    return (await this.#request({
      method: "POST",
      path: "/habits",
      body: input,
      valid: isHabitDto,
    })) as HabitDto;
  }

  async updateHabit(id: string, patch: UpdateHabitCommand): Promise<HabitDto> {
    return (await this.#request({
      method: "PATCH",
      path: `/habits/${encodeURIComponent(id)}`,
      body: patch,
      valid: isHabitDto,
    })) as HabitDto;
  }

  async createSeason(circleId: string, input: CreateSeasonCommand): Promise<SeasonDto> {
    return (await this.#request({
      method: "POST",
      path: `${circlePath(circleId)}/seasons`,
      body: input,
      valid: isSeasonDto,
    })) as SeasonDto;
  }

  async editSeason(seasonId: string, input: EditSeasonCommand): Promise<SeasonDto> {
    return (await this.#request({
      method: "PATCH",
      path: seasonPath(seasonId),
      body: input,
      valid: isSeasonDto,
    })) as SeasonDto;
  }

  async getSeason(seasonId: string, signal?: AbortSignal): Promise<SeasonDto> {
    return (await this.#request({
      method: "GET",
      path: seasonPath(seasonId),
      signal,
      valid: isSeasonDto,
    })) as SeasonDto;
  }

  async addCommitment(seasonId: string, input: AddCommitmentCommand): Promise<SeasonDto> {
    return (await this.#request({
      method: "POST",
      path: `${seasonPath(seasonId)}/commitments`,
      body: input,
      valid: isSeasonDto,
    })) as SeasonDto;
  }

  async editCommitment(
    seasonId: string,
    commitmentId: string,
    input: EditCommitmentCommand,
  ): Promise<SeasonDto> {
    return (await this.#request({
      method: "PUT",
      path: commitmentPath(seasonId, commitmentId),
      body: input,
      valid: isSeasonDto,
    })) as SeasonDto;
  }

  async removeCommitment(seasonId: string, commitmentId: string): Promise<SeasonDto> {
    return (await this.#request({
      method: "DELETE",
      path: commitmentPath(seasonId, commitmentId),
      valid: isSeasonDto,
    })) as SeasonDto;
  }

  async approvePact(seasonId: string, expectedPactRevision: number): Promise<SeasonDto> {
    return (await this.#request({
      method: "PUT",
      path: `${seasonPath(seasonId)}/approval`,
      body: { expectedPactRevision },
      valid: isSeasonDto,
    })) as SeasonDto;
  }

  async withdrawApproval(seasonId: string): Promise<SeasonDto> {
    return (await this.#request({
      method: "DELETE",
      path: `${seasonPath(seasonId)}/approval`,
      valid: isSeasonDto,
    })) as SeasonDto;
  }

  async previewScoring(
    input: PreviewScoringCommand,
    signal?: AbortSignal,
  ): Promise<ScoringPreview> {
    return (await this.#request({
      method: "POST",
      path: "/scoring/preview",
      body: input,
      signal,
      valid: isScoringPreview,
    })) as ScoringPreview;
  }

  async getToday(signal?: AbortSignal): Promise<TodayView> {
    return (await this.#request({
      method: "GET",
      path: "/me/today",
      signal,
      valid: isTodayView,
    })) as TodayView;
  }

  async recordEntry(cmd: RecordEntryCommand): Promise<RecordedEntry> {
    const { seasonId, ...body } = cmd;
    const data = await this.#request({
      method: "POST",
      path: `/seasons/${encodeURIComponent(seasonId)}/entries`,
      body,
      valid: isRecordResult,
    });
    const { entry, replayed } = data as { entry: { id: string }; replayed: boolean };
    return { entryId: entry.id, replayed };
  }

  async editEntry(cmd: EditEntryCommand): Promise<void> {
    const { entryId, ...body } = cmd;
    await this.#request({ method: "PUT", path: `/entries/${encodeURIComponent(entryId)}`, body });
  }

  async deleteEntry(entryId: string): Promise<void> {
    await this.#request({ method: "DELETE", path: `/entries/${encodeURIComponent(entryId)}` });
  }

  async requestPhotoUpload(cmd: RequestPhotoUploadCommand): Promise<PhotoUploadDto> {
    return (await this.#request({
      method: "POST",
      path: `${commitmentPath(cmd.seasonId, cmd.commitmentId)}/photos`,
      // The only type a photo has: the client re-encodes every pick as JPEG before this call.
      body: { byteSize: cmd.byteSize, contentType: "image/jpeg" },
      valid: isPhotoUpload,
    })) as PhotoUploadDto;
  }

  async getMyCircle(signal?: AbortSignal): Promise<MyCircle> {
    return (await this.#request({
      method: "GET",
      path: "/me/circle",
      signal,
      valid: isMyCircle,
    })) as MyCircle;
  }

  async previewInvite(inviteCode: string, signal?: AbortSignal): Promise<InvitePreviewView> {
    // The code travels in the body, never the URL, so it stays out of logs.
    return (await this.#request({
      method: "POST",
      path: "/circles/join/preview",
      body: { inviteCode },
      signal,
      valid: isPreview,
    })) as InvitePreviewView;
  }

  async createCircle(cmd: CreateCircleCommand): Promise<CircleRef> {
    const data = await this.#request({
      method: "POST",
      path: "/circles",
      body: cmd,
      valid: isCircleRef,
    });
    return { circleId: (data as { id: string }).id };
  }

  async joinCircle(cmd: JoinCircleCommand): Promise<CircleRef> {
    const data = await this.#request({
      method: "POST",
      path: "/circles/join",
      body: cmd,
      valid: isCircleRef,
    });
    return { circleId: (data as { id: string }).id };
  }

  async generateInvite(circleId: string): Promise<CircleInvite> {
    return (await this.#request({
      method: "POST",
      path: `${circlePath(circleId)}/invite`,
      valid: isInvite,
    })) as CircleInvite;
  }

  async renameCircle(circleId: string, name: string): Promise<void> {
    await this.#request({ method: "PATCH", path: circlePath(circleId), body: { name } });
  }

  async renameMyDisplayName(circleId: string, displayName: string): Promise<void> {
    await this.#request({
      method: "PATCH",
      path: `${circlePath(circleId)}/members/me`,
      body: { displayName },
    });
  }

  async leaveCircle(circleId: string): Promise<void> {
    await this.#request({ method: "POST", path: `${circlePath(circleId)}/leave` });
  }

  async requestPause(seasonId: string, cmd: RequestPauseCommand): Promise<PauseRequestDto> {
    return (await this.#request({
      method: "POST",
      path: `${seasonPath(seasonId)}/pause-requests`,
      body: cmd,
      valid: isPauseRequest,
    })) as PauseRequestDto;
  }

  async getMyPauseRequests(signal?: AbortSignal): Promise<MyPauseRequests> {
    return this.#read("/me/pause-requests", isMyPauseRequests, signal);
  }

  async respondToPause(pauseRequestId: string, decision: PauseDecision): Promise<PauseApprovalDto> {
    return (await this.#request({
      method: "PUT",
      path: `${pausePath(pauseRequestId)}/response`,
      body: { decision },
      valid: isPauseApproval,
    })) as PauseApprovalDto;
  }

  async cancelPauseRequest(pauseRequestId: string): Promise<PauseRequestDto> {
    return (await this.#request({
      method: "DELETE",
      path: pausePath(pauseRequestId),
      valid: isPauseRequest,
    })) as PauseRequestDto;
  }

  async resumePause(pauseRequestId: string, commitmentId?: string): Promise<PauseRequestDto> {
    return (await this.#request({
      method: "POST",
      path: `${pausePath(pauseRequestId)}/resume`,
      body: commitmentId === undefined ? {} : { commitmentId },
      valid: isPauseRequest,
    })) as PauseRequestDto;
  }

  async getReview(
    seasonId: string,
    periodIndex: number,
    signal?: AbortSignal,
  ): Promise<ReviewDraftDto> {
    return this.#read(reviewPath(seasonId, periodIndex), isReviewDraft, signal);
  }

  async submitReview(
    seasonId: string,
    periodIndex: number,
    cmd: SubmitReviewCommand,
  ): Promise<SubmittedReviewDto> {
    return (await this.#request({
      method: "POST",
      path: reviewPath(seasonId, periodIndex),
      body: cmd,
      valid: isSubmittedReview,
    })) as SubmittedReviewDto;
  }

  async skipBaseline(seasonId: string): Promise<void> {
    await this.#request({
      method: "POST",
      path: `${reviewPath(seasonId, 0)}/skip`,
      valid: isSkippedBaseline,
    });
  }

  async getCommitmentStage(
    seasonId: string,
    commitmentId: string,
    signal?: AbortSignal,
  ): Promise<CommitmentStageDto> {
    return this.#read(`${commitmentPath(seasonId, commitmentId)}/stage`, isCommitmentStage, signal);
  }

  async getCommitmentReminder(
    seasonId: string,
    commitmentId: string,
    signal?: AbortSignal,
  ): Promise<CommitmentReminderDto> {
    return this.#read(
      `${commitmentPath(seasonId, commitmentId)}/reminder`,
      isCommitmentReminder,
      signal,
    );
  }

  async setCommitmentReminder(
    seasonId: string,
    commitmentId: string,
    setting: ReminderSettingCommand,
  ): Promise<CommitmentReminderDto> {
    return (await this.#request({
      method: "PUT",
      path: `${commitmentPath(seasonId, commitmentId)}/reminder`,
      body: setting,
      valid: isCommitmentReminder,
    })) as CommitmentReminderDto;
  }

  async getSeasonResults(seasonId: string, signal?: AbortSignal): Promise<SeasonResultsDto> {
    return this.#read(`${seasonPath(seasonId)}/results`, isSeasonResults, signal);
  }

  async submitSeasonClosure(
    seasonId: string,
    cmd: SubmitClosureCommand,
  ): Promise<SubmittedClosureDto> {
    return (await this.#request({
      method: "POST",
      path: `${seasonPath(seasonId)}/closure`,
      body: cmd,
      valid: isSubmittedClosure,
    })) as SubmittedClosureDto;
  }

  async getCarryOver(seasonId: string, signal?: AbortSignal): Promise<CarryOverDto> {
    return this.#read(`${seasonPath(seasonId)}/carry-over`, isCarryOver, signal);
  }

  async getSeasonHistory(signal?: AbortSignal): Promise<SeasonHistoryDto> {
    return this.#read("/me/seasons", isSeasonHistory, signal);
  }

  async getProfileSummary(signal?: AbortSignal): Promise<ProfileSummaryDto> {
    return this.#read("/me/profile", isProfileSummary, signal);
  }

  async feed(cursor?: string | null, signal?: AbortSignal): Promise<CircleFeedDto> {
    const path =
      cursor === undefined || cursor === null
        ? "/me/feed"
        : `/me/feed/after/${encodeURIComponent(cursor)}`;
    return this.#read(path, isCircleFeed, signal);
  }

  async reactToFeedItem(
    seasonId: string,
    itemKey: string,
    emoji: ReactionCode,
  ): Promise<ReactionsDto> {
    return (await this.#request({
      method: "PUT",
      path: reactionPath(seasonId, itemKey),
      body: { emoji },
      valid: isReactions,
    })) as ReactionsDto;
  }

  async removeFeedReaction(seasonId: string, itemKey: string): Promise<ReactionsDto> {
    return (await this.#request({
      method: "DELETE",
      path: reactionPath(seasonId, itemKey),
      valid: isReactions,
    })) as ReactionsDto;
  }

  async sendEncouragement(seasonId: string, cmd: SendEncouragementCommand): Promise<void> {
    await this.#request({
      method: "POST",
      path: `${seasonPath(seasonId)}/encouragements`,
      body: cmd,
      valid: isSentEncouragement,
    });
  }

  async dismissNudge(seasonId: string, cmd: DismissNudgeCommand): Promise<void> {
    await this.#request({
      method: "POST",
      path: `${seasonPath(seasonId)}/nudge-dismissals`,
      body: cmd,
    });
  }

  async getPushConfig(signal?: AbortSignal): Promise<PushConfigDto> {
    return this.#read("/me/push-config", isPushConfig, signal);
  }

  async savePushSubscription(subscription: DevicePushSubscription): Promise<void> {
    await this.#request({ method: "PUT", path: "/me/push-subscription", body: subscription });
  }

  async removePushSubscription(endpoint: string): Promise<void> {
    await this.#request({
      method: "POST",
      path: "/me/push-subscription/remove",
      body: { endpoint },
    });
  }

  async getSeasonProgress(seasonId: string, signal?: AbortSignal): Promise<SeasonProgress> {
    return this.#read(progressApiPaths.season(seasonId), isSeasonProgress, signal);
  }

  async getMemberProgress(
    seasonId: string,
    memberId: string,
    signal?: AbortSignal,
  ): Promise<MemberProgress> {
    return this.#read(progressApiPaths.member(seasonId, memberId), isMemberProgress, signal);
  }

  async getCommitmentProgress(
    seasonId: string,
    commitmentId: string,
    signal?: AbortSignal,
  ): Promise<CommitmentProgress> {
    return this.#read(
      progressApiPaths.commitment(seasonId, commitmentId),
      isCommitmentProgress,
      signal,
    );
  }

  async getWeekSummary(
    seasonId: string,
    weekIndex: number,
    signal?: AbortSignal,
  ): Promise<WeekSummary> {
    return this.#read(progressApiPaths.week(seasonId, weekIndex), isWeekSummary, signal);
  }

  /** A GET whose 2xx `data` must pass `guard`; typed by the guard, so nothing is cast. */
  async #read<T>(
    path: string,
    guard: (data: unknown) => data is T,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const data = await this.#request({ method: "GET", path, signal, valid: guard });
    // Already checked by #unwrap; repeated only to narrow the type.
    if (!guard(data)) throw new ApiError("Internal", 200, null);
    return data;
  }

  async #request(request: HttpRequest): Promise<unknown> {
    const first = await this.#send(request, await this.#options.getAccessToken());
    if (first.status !== 401) return this.#unwrap(first, request);

    // One refresh attempt, then one retry. A second 401 ends the session (no loop).
    const refreshed = await this.#options.refreshAccessToken();
    if (refreshed.status === "rejected") return this.#unauthorized(first);
    // A refresh that failed for a transient reason (network, 429, 5xx, gateway) must not log the
    // user out: surface a retryable error and keep the session.
    if (refreshed.status === "transient") {
      throw new ApiError("ServiceUnavailable", 503, first.headers.get("X-Request-Id"));
    }
    const second = await this.#send(request, refreshed.token);
    if (second.status === 401) return this.#unauthorized(second);
    return this.#unwrap(second, request);
  }

  async #unauthorized(response: Response): Promise<never> {
    this.#options.onUnauthorized();
    throw await toApiError(response);
  }

  async #send(request: HttpRequest, token: string | null): Promise<Response> {
    const headers = new Headers();
    if (token !== null) headers.set("Authorization", `Bearer ${token}`);
    if (request.body !== undefined) headers.set("Content-Type", "application/json");
    try {
      return await this.#options.fetch(`${this.#options.baseUrl}${request.path}`, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      // Also covers the API's empty 503 without CORS headers, which a browser reports as a TypeError.
      throw new ApiError("NetworkError", 0, null);
    }
  }

  async #unwrap(response: Response, request: HttpRequest): Promise<unknown> {
    if (!response.ok) throw await toApiError(response);
    const parsed: unknown = await response.json().catch(() => null);
    const data = isRecord(parsed) ? parsed.data : undefined;
    // A 2xx that is not a valid envelope is a server fault, never a value the screens may trust.
    if (data === undefined || (request.valid !== undefined && !request.valid(data))) {
      throw new ApiError("Internal", response.status, response.headers.get("X-Request-Id"));
    }
    return data;
  }
}
