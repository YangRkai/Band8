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
  };
}
