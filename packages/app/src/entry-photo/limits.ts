/**
 * Photo evidence limits (ADR-0016). Constants, not configuration: the bucket limits in
 * `supabase/config.toml` repeat `MAX_PHOTO_BYTES` as defence in depth and a boundary test pins both.
 */

/** Largest stored photo: 3 MiB. */
export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** How long a signed upload URL is valid. */
export const UPLOAD_URL_TTL_SECONDS = 300;

/** How long a signed download URL is valid. */
export const DOWNLOAD_URL_TTL_SECONDS = 600;

/**
 * How long a reservation can still be attached to an Entry. It MUST outlast the upload URL (P5),
 * or a PUT could land after the pending row was swept and leave an orphan object.
 */
export const ATTACH_WINDOW_MS = 30 * 60 * 1000;

/** Unexpired pending reservations one member may hold at a time. */
export const MAX_OPEN_UPLOADS = 5;

/** Rows one sweep releases or purges per call. */
export const SWEEP_BATCH = 20;
