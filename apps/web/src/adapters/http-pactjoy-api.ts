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
  ScoringPreview,
  UpdateHabitCommand,
} from "../ports/pactjoy-api.ts";

import type { HabitDto, SeasonDto } from "../ports/wire.ts";

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
const isHabitList = (data: unknown): boolean => isRecord(data) && Array.isArray(data.habits);
const isScoringPreview = (data: unknown): boolean => isRecord(data) && Array.isArray(data.rows);

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
      valid: isCircleRef,
    })) as HabitDto;
  }

  async updateHabit(id: string, patch: UpdateHabitCommand): Promise<HabitDto> {
    return (await this.#request({
      method: "PATCH",
      path: `/habits/${encodeURIComponent(id)}`,
      body: patch,
      valid: isCircleRef,
    })) as HabitDto;
  }

  async createSeason(circleId: string, input: CreateSeasonCommand): Promise<SeasonDto> {
    return (await this.#request({
      method: "POST",
      path: `${circlePath(circleId)}/seasons`,
      body: input,
      valid: isCircleRef,
    })) as SeasonDto;
  }

  async editSeason(seasonId: string, input: EditSeasonCommand): Promise<SeasonDto> {
    return (await this.#request({
      method: "PATCH",
      path: seasonPath(seasonId),
      body: input,
      valid: isCircleRef,
    })) as SeasonDto;
  }

  async getSeason(seasonId: string, signal?: AbortSignal): Promise<SeasonDto> {
    return (await this.#request({
      method: "GET",
      path: seasonPath(seasonId),
      signal,
      valid: isCircleRef,
    })) as SeasonDto;
  }

  async addCommitment(seasonId: string, input: AddCommitmentCommand): Promise<SeasonDto> {
    return (await this.#request({
      method: "POST",
      path: `${seasonPath(seasonId)}/commitments`,
      body: input,
      valid: isCircleRef,
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
      valid: isCircleRef,
    })) as SeasonDto;
  }

  async removeCommitment(seasonId: string, commitmentId: string): Promise<SeasonDto> {
    return (await this.#request({
      method: "DELETE",
      path: commitmentPath(seasonId, commitmentId),
      valid: isCircleRef,
    })) as SeasonDto;
  }

  async approvePact(seasonId: string, expectedPactRevision: number): Promise<SeasonDto> {
    return (await this.#request({
      method: "PUT",
      path: `${seasonPath(seasonId)}/approval`,
      body: { expectedPactRevision },
      valid: isCircleRef,
    })) as SeasonDto;
  }

  async withdrawApproval(seasonId: string): Promise<SeasonDto> {
    return (await this.#request({
      method: "DELETE",
      path: `${seasonPath(seasonId)}/approval`,
      valid: isCircleRef,
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
