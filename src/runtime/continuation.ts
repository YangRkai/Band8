import { createHash } from "node:crypto";

import { canonicalHash } from "../protocol/canonical.js";

type Document = Record<string, any>;

export function continuationSessionId(priorSessionId: string, segmentId: string): string {
  const digest = createHash("sha256").update(`${priorSessionId}:${segmentId}`, "utf8").digest("hex").slice(0, 24);
  return `session-continuation-${digest}`;
}

export function priorEvidenceFingerprint(events: Document[], artifacts: Document[]): string {
  return canonicalHash({
    events,
    artifacts: artifacts
      .map((metadata) => ({ artifact_id: metadata.artifact_id, content_hash: metadata.content_hash }))
      .sort((left, right) => String(left.artifact_id).localeCompare(String(right.artifact_id))),
  });
}
