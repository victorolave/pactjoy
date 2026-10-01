export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface ErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** What a controller returns; only the envelope serializes it. */
export type ApiResult =
  | { readonly status: number; readonly data: unknown }
  | { readonly status: number; readonly error: ErrorBody };

/** The Web-standard request handler every runtime adapter wraps. */
export type Handler = (request: Request) => Promise<Response>;
