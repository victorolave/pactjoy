import type { EvidenceStorage } from "@pactjoy/app";

const refuse = () => Promise.reject(new Error("this process has no object storage"));

/**
 * An {@link EvidenceStorage} for callers that never record, edit or read a photo (the dev seed,
 * database tests of other features): any call is a bug and says so. The database package does not
 * own object storage (`packages/storage` does, ADR-0016).
 */
export const noEvidenceStorage: EvidenceStorage = {
  signUpload: refuse,
  signDownloads: refuse,
  stat: refuse,
  readHead: refuse,
  delete: refuse,
};
