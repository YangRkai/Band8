import { validateArtifactSemantics } from "./artifact-validator.js";
import { validateCheckpointSemantics, validateContinuationSemantics } from "./checkpoint-validator.js";
import { validateEventsSemantics } from "./event-validator.js";
import { validatePackageSemantics, validateProtectedSemantics } from "./package-validator.js";
import { validateResultSemantics } from "./result-validator.js";
import { createStructuralValidator } from "./schema-validator.js";

export class ProtocolValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolValidationError";
  }
}

export type EventValidationMode = "prefix" | "complete";

export interface EventValidationOptions {
  packageDocument?: unknown;
  mode: EventValidationMode;
  artifacts?: ReadonlyMap<string, Record<string, any>>;
  artifactRoot?: string;
}

export interface ProtocolValidator {
  validatePackage(document: unknown, seenPackages?: ReadonlyMap<string, string>): { identity: "accepted" | "idempotent" };
  validateProtectedEvaluation(document: unknown, packageDocument: unknown): void;
  validateArtifact(document: unknown): void;
  validateCheckpoint(document: unknown, packageDocument: unknown): void;
  validateContinuation(document: unknown, priorPackage: unknown, checkpoint: unknown): void;
  validateEventStream(
    events: unknown[],
    options: EventValidationOptions,
  ): { state: "VALID_INCOMPLETE" | "COMPLETED" | "ABORTED" | "AWAITING_COACH" | "QUARANTINED" };
  validateResult(
    result: unknown,
    events: unknown[],
    packageDocument: unknown,
    protectedEvaluation?: unknown,
    artifactOptions?: Pick<EventValidationOptions, "artifacts" | "artifactRoot">,
  ): void;
  validateReinforcementDecision(document: unknown, evidenceIds?: ReadonlySet<string>): void;
}

function decisionEvidenceRefs(chain: Record<string, any>): Set<string> {
  const refs = new Set<string>();
  for (const item of [...chain.recurring_weakness, ...chain.repeated_improvement]) refs.add(item.evidence_ref);
  for (const item of [...chain.unresolved_contradictory_assessment_refs, ...chain.regression_evidence_refs]) refs.add(item);
  for (const item of [chain.targeted_intervention, chain.delayed_retrieval, chain.transfer]) {
    if (item !== null) refs.add(item.evidence_ref);
  }
  return refs;
}

function validateReinforcementSemantics(document: Record<string, any>, evidenceIds?: ReadonlySet<string>): void {
  const chain = document.evidence_chain as Record<string, any>;
  if (document.decision_type === "historical_award") {
    if (document.qualification !== "confirmed" || document.supersedes !== null) {
      throw new ProtocolValidationError("historical award must be an original confirmed decision");
    }
    const weakness = chain.recurring_weakness as Array<Record<string, any>>;
    if (weakness.length < 2 || new Set(weakness.map((item) => item.session_id)).size < 2 || weakness.some((item) => item.outcome !== "unsuccessful")) {
      throw new ProtocolValidationError("PATTERN_BROKEN requires weakness in two earlier sessions");
    }
    const intervention = chain.targeted_intervention as Record<string, any> | null;
    if (intervention === null) throw new ProtocolValidationError("PATTERN_BROKEN requires a targeted intervention");
    const interventionTime = Date.parse(intervention.occurred_at);
    if (weakness.some((item) => Date.parse(item.occurred_at) >= interventionTime)) {
      throw new ProtocolValidationError("PATTERN_BROKEN weaknesses must precede the intervention");
    }
    const improvements = chain.repeated_improvement as Array<Record<string, any>>;
    if (
      improvements.length < 2
      || new Set(improvements.map((item) => item.session_id)).size < 2
      || improvements.some((item) => item.outcome !== "successful" || Date.parse(item.occurred_at) <= interventionTime)
    ) throw new ProtocolValidationError("PATTERN_BROKEN requires two successful improvements after intervention");
    const delayed = chain.delayed_retrieval as Record<string, any> | null;
    if (
      delayed === null
      || delayed.outcome !== "successful"
      || delayed.delay_seconds < 86_400
      || Date.parse(delayed.occurred_at) - interventionTime < 86_400_000
    ) throw new ProtocolValidationError("PATTERN_BROKEN requires successful retrieval after 24 hours");
    const transfer = chain.transfer as Record<string, any> | null;
    if (transfer === null || transfer.outcome !== "successful" || transfer.source_resource_hash === transfer.transfer_resource_hash) {
      throw new ProtocolValidationError("PATTERN_BROKEN requires successful changed-material transfer");
    }
    if (chain.unresolved_contradictory_assessment_refs.length > 0) {
      throw new ProtocolValidationError("unresolved assessment contradiction blocks PATTERN_BROKEN");
    }
    if (chain.regression_evidence_refs.length > 0) {
      throw new ProtocolValidationError("historical award cannot contain later regression evidence");
    }
  } else {
    if (document.supersedes === null || document.qualification === "confirmed") {
      throw new ProtocolValidationError("qualification update must supersede and reduce a prior decision");
    }
    if (chain.regression_evidence_refs.length === 0) {
      throw new ProtocolValidationError("reduced qualification requires regression evidence");
    }
  }
  if (evidenceIds !== undefined) {
    for (const reference of decisionEvidenceRefs(chain)) {
      if (!evidenceIds.has(reference)) throw new ProtocolValidationError("reinforcement decision has unresolved evidence");
    }
  }
}

export function createProtocolValidator(repositoryRoot: string): ProtocolValidator {
  const structural = createStructuralValidator(repositoryRoot);
  return {
    validatePackage(document, seenPackages) {
      structural("package", document);
      return validatePackageSemantics(document as Record<string, any>, seenPackages);
    },
    validateProtectedEvaluation(document, packageDocument) {
      structural("protected-evaluation", document);
      structural("package", packageDocument);
      validatePackageSemantics(packageDocument as Record<string, any>);
      validateProtectedSemantics(document as Record<string, any>, packageDocument as Record<string, any>);
    },
    validateArtifact(document) {
      structural("artifact", document);
      validateArtifactSemantics(document as Record<string, any>);
    },
    validateCheckpoint(document, packageDocument) {
      structural("checkpoint", document);
      structural("package", packageDocument);
      validatePackageSemantics(packageDocument as Record<string, any>);
      validateCheckpointSemantics(document as Record<string, any>, packageDocument as Record<string, any>);
    },
    validateContinuation(document, priorPackage, checkpoint) {
      structural("package", document);
      structural("package", priorPackage);
      structural("checkpoint", checkpoint);
      validatePackageSemantics(priorPackage as Record<string, any>);
      validateCheckpointSemantics(checkpoint as Record<string, any>, priorPackage as Record<string, any>);
      validatePackageSemantics(document as Record<string, any>);
      validateContinuationSemantics(
        document as Record<string, any>,
        priorPackage as Record<string, any>,
        checkpoint as Record<string, any>,
      );
    },
    validateEventStream(events, options) {
      for (const event of events) structural("event", event);
      if (options.packageDocument !== undefined) {
        structural("package", options.packageDocument);
        validatePackageSemantics(options.packageDocument as Record<string, any>);
      }
      return validateEventsSemantics(
        events as Array<Record<string, any>>,
        options.packageDocument as Record<string, any> | undefined,
        options.mode,
        options.artifacts,
        options.artifactRoot,
      );
    },
    validateResult(result, events, packageDocument, protectedEvaluation, artifactOptions) {
      structural("result", result);
      structural("package", packageDocument);
      validatePackageSemantics(packageDocument as Record<string, any>);
      if (protectedEvaluation !== undefined) {
        structural("protected-evaluation", protectedEvaluation);
        validateProtectedSemantics(protectedEvaluation as Record<string, any>, packageDocument as Record<string, any>);
      }
      for (const event of events) structural("event", event);
      validateEventsSemantics(
        events as Array<Record<string, any>>,
        packageDocument as Record<string, any>,
        "complete",
        artifactOptions?.artifacts,
        artifactOptions?.artifactRoot,
      );
      validateResultSemantics(
        result as Record<string, any>,
        events as Array<Record<string, any>>,
        packageDocument as Record<string, any>,
        protectedEvaluation as Record<string, any> | undefined,
      );
    },
    validateReinforcementDecision(document, evidenceIds) {
      structural("reinforcement-decision", document);
      validateReinforcementSemantics(document as Record<string, any>, evidenceIds);
    },
  };
}
