import { instant } from "@pactjoy/app";
import { describeEvidenceStorageContract } from "@pactjoy/app/contracts";
import { afterAll } from "vitest";
import { createS3EvidenceStorage } from "../src/index.ts";
import { type S3Source, startS3Source } from "./s3-source.ts";

let started: Promise<S3Source> | undefined;
const source = () => {
  started ??= startS3Source();
  return started;
};

afterAll(async () => {
  await (await started)?.stop();
});

// The same suite the in-memory fake runs, against a real S3 server: this proves the signatures,
// not just the bookkeeping (a wrong host, length or type must be refused by the server).
describeEvidenceStorageContract("S3 adapter on MinIO", async () => {
  const s3 = await source();
  const storage = createS3EvidenceStorage({
    endpoint: s3.endpoint,
    region: s3.region,
    bucket: s3.bucket,
    accessKeyId: s3.accessKeyId,
    secretAccessKey: s3.secretAccessKey,
  });
  return {
    storage,
    now: () => instant(Date.now()),
    async upload(request, bytes, headers) {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { ...(headers ?? request.headers) },
        body: bytes as BodyInit,
      });
      return response.ok ? "accepted" : "rejected";
    },
    async download(request) {
      const response = await fetch(request.url, { method: request.method });
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    },
  };
});
