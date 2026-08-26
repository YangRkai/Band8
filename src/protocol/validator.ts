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
}

export interface ProtocolValidator {
  validatePackage(document: unknown, seenPackages?: ReadonlyMap<string, string>): { identity: "accepted" | "idempotent" };
  validateProtectedEvaluation(document: unknown, packageDocument: unknown): void;
  validateEventStream(
    events: unknown[],
    options: EventValidationOptions,
  ): { state: "VALID_INCOMPLETE" | "COMPLETED" | "ABORTED" | "AWAITING_COACH" | "QUARANTINED" };
  validateResult(result: unknown, events: unknown[], packageDocument: unknown, protectedEvaluation: unknown): void;
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
      );
    },
    validateResult(result, events, packageDocument, protectedEvaluation) {
      structural("result", result);
      structural("package", packageDocument);
      structural("protected-evaluation", protectedEvaluation);
      validatePackageSemantics(packageDocument as Record<string, any>);
      validateProtectedSemantics(protectedEvaluation as Record<string, any>, packageDocument as Record<string, any>);
      for (const event of events) structural("event", event);
      validateEventsSemantics(events as Array<Record<string, any>>, packageDocument as Record<string, any>, "complete");
      validateResultSemantics(
        result as Record<string, any>,
        events as Array<Record<string, any>>,
        packageDocument as Record<string, any>,
        protectedEvaluation as Record<string, any>,
      );
    },
  };
}
