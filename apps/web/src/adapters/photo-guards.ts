import type { PhotoUploadDto } from "../ports/wire.ts";

/**
 * Runtime check for the reservation the API answers (`POST .../photos`, ADR-0016): a signed PUT the
 * browser may run and the id to attach afterwards. Structure only; a wrong 2xx becomes
 * ApiError("Internal"), never an upload to a URL the client could not vouch for.
 */

const isRec = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const filled = (value: unknown): value is string => typeof value === "string" && value.length > 0;

export function isPhotoUpload(data: unknown): data is PhotoUploadDto {
  if (!isRec(data) || !filled(data.photoId) || !filled(data.attachBy) || !isRec(data.upload)) {
    return false;
  }
  const { method, url, headers, expiresAt } = data.upload;
  return (
    method === "PUT" &&
    filled(url) &&
    filled(expiresAt) &&
    isRec(headers) &&
    Object.values(headers).every((value) => typeof value === "string")
  );
}
