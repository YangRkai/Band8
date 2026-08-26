import { canonicalHash } from "./canonical.js";
import { ProtocolValidationError } from "./validator.js";

type Document = Record<string, any>;

function fail(message: string): never {
  throw new ProtocolValidationError(message);
}

export function validateCheckpointSemantics(checkpoint: Document, packageDocument: Document): void {
  const configured = packageDocument.completion_policy.coach_checkpoint as Document | null;
  if (configured === null) fail("package does not declare a Coach checkpoint");
  if (checkpoint.package_hash !== canonicalHash(packageDocument)) fail("checkpoint package hash mismatch");
  const expected = [
    configured.checkpoint_id,
    configured.checkpoint_reason,
    packageDocument.package_id,
    packageDocument.run_id,
    packageDocument.segment_id,
  ];
  const actual = [
    checkpoint.checkpoint_id,
    checkpoint.checkpoint_reason,
    checkpoint.package_id,
    checkpoint.run_id,
    checkpoint.segment_id,
  ];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("checkpoint does not match package orchestration");
}

export function validateContinuationSemantics(
  continuationPackage: Document,
  priorPackage: Document,
  checkpoint: Document,
): void {
  const binding = continuationPackage.continuation as Document | null;
  if (binding === null) fail("continuation package lacks continuation binding");
  if (continuationPackage.run_id !== priorPackage.run_id) fail("continuation must preserve run_id");
  if (continuationPackage.segment_id === priorPackage.segment_id) fail("continuation must advance segment_id");
  const expected = [priorPackage.package_id, priorPackage.segment_id, checkpoint.checkpoint_id];
  const actual = [binding.continuation_of, binding.prior_segment_id, binding.checkpoint_id];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) fail("continuation binding does not match checkpoint");
  const required = [...(binding.required_evidence_refs as string[])].sort();
  const checkpointRequired = [...(checkpoint.required_evidence_refs as string[])].sort();
  if (JSON.stringify(required) !== JSON.stringify(checkpointRequired)) fail("continuation must consume the checkpoint evidence set");
  const priorAttempts = new Set<string>((priorPackage.activities as Document[]).map((activity) => activity.attempt_id));
  const currentAttempts = new Set<string>((continuationPackage.activities as Document[]).map((activity) => activity.attempt_id));
  for (const activity of continuationPackage.activities as Document[]) {
    const revisionOf = activity.relationships.revision_of as string | null;
    if (revisionOf !== null && !priorAttempts.has(revisionOf) && !currentAttempts.has(revisionOf)) {
      fail("continuation revision_of does not resolve");
    }
    if (activity.pedagogical_intent === "transfer") {
      if (activity.relationships.revision_of !== null || activity.relationships.feedback_ref !== null || activity.relationships.source_output_ref !== null) {
        fail("transfer activity must be a new non-revision attempt");
      }
      const priorHashes = new Set<string>((priorPackage.resources as Document[]).map((resource) => resource.provenance.content_hash));
      const resources = new Map<string, Document>((continuationPackage.resources as Document[]).map((resource) => [resource.resource_id, resource]));
      const transferResources = (activity.resource_refs as string[]).map((resourceId) => resources.get(resourceId));
      if (transferResources.length === 0 || transferResources.some((resource) => resource === undefined || priorHashes.has(resource.provenance.content_hash))) {
        fail("transfer activity requires changed material with a new content hash");
      }
    }
    const feedbackRef = activity.relationships.feedback_ref as string | null;
    if (feedbackRef !== null) {
      const feedback = (continuationPackage.resources as Document[]).find((resource) => resource.resource_id === feedbackRef);
      const provenance = feedback?.provenance as Document | undefined;
      if (
        feedback?.resource_type !== "feedback"
        || provenance?.origin_type !== "generated"
        || provenance.generator?.producer !== continuationPackage.generator.producer
        || !/codex/iu.test(String(provenance.generator?.producer ?? ""))
      ) {
        fail("feedback requires generated External Coach provenance");
      }
    }
  }
}
