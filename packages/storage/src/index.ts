/**
 * Public API of `@pactjoy/storage` (ADR-0016): the S3-protocol adapter for the `EvidenceStorage`
 * port of `@pactjoy/app`, and the SigV4 presigner it is built on.
 */

export type { S3EvidenceStorageOptions } from "./s3-evidence-storage.ts";
export { createS3EvidenceStorage } from "./s3-evidence-storage.ts";
export type { Credentials, PresignOptions } from "./sigv4.ts";
export { presign } from "./sigv4.ts";
