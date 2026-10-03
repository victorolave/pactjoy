import type { TodayView } from "@pactjoy/app";
import { ApiError } from "../ports/api-error.ts";
import type { PactJoyApi } from "../ports/pactjoy-api.ts";

export interface HttpPactJoyApiOptions {
  readonly baseUrl: string;
  /** The current access token, refreshed ahead of expiry by the session manager. */
  readonly getAccessToken: () => Promise<string | null>;
  /** Forces a refresh after a 401. Resolves the new token, or null when it cannot refresh. */
  readonly refreshAccessToken: () => Promise<string | null>;
  /** Called once when a request is still unauthorized after the refresh attempt. */
  readonly onUnauthorized: () => void;
  readonly fetch: typeof fetch;
}

interface HttpRequest {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
  readonly signal?: AbortSignal | undefined;
  /** Shape check for the 2xx `data`; a failure becomes ApiError("Internal"). Omitted = anything. */
  readonly valid?: (data: unknown) => boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isTodayView = (data: unknown): boolean => isRecord(data) && typeof data.state === "string";

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

  async getToday(signal?: AbortSignal): Promise<TodayView> {
    return (await this.#request({
      method: "GET",
      path: "/me/today",
      signal,
      valid: isTodayView,
    })) as TodayView;
  }

  async #request(request: HttpRequest): Promise<unknown> {
    const first = await this.#send(request, await this.#options.getAccessToken());
    if (first.status !== 401) return this.#unwrap(first, request);

    // One refresh attempt, then one retry. A second 401 ends the session (no loop).
    const token = await this.#options.refreshAccessToken();
    if (token === null) return this.#unauthorized(first);
    const second = await this.#send(request, token);
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
