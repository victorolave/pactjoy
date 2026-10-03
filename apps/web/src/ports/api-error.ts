/**
 * The single error type adapters throw (TanStack Query's contract). `code` is the API's error
 * kind verbatim, or one of the client-side codes `NetworkError`, `ServiceUnavailable` and
 * `Internal` when no usable envelope came back. `status` 0 means the request never got a response.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: string,
    status: number,
    requestId: string | null,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
    this.details = details;
  }
}
