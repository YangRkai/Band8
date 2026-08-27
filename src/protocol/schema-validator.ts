import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { ProtocolValidationError } from "./validator.js";

export type SchemaKind = "package" | "protected-evaluation" | "event" | "result" | "artifact" | "checkpoint" | "reinforcement-decision";

const schemaFiles: Record<SchemaKind, string> = {
  package: "training-package.schema.json",
  "protected-evaluation": "protected-evaluation.schema.json",
  event: "session-event.schema.json",
  result: "session-result.schema.json",
  artifact: "artifact-metadata.schema.json",
  checkpoint: "checkpoint.schema.json",
  "reinforcement-decision": "reinforcement-decision.schema.json",
};

function describeErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "$"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

export function createStructuralValidator(repositoryRoot: string): (kind: SchemaKind, value: unknown) => void {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const installFormats = addFormats as unknown as (instance: Ajv2020) => Ajv2020;
  installFormats(ajv);
  const compiled = new Map<SchemaKind, ValidateFunction>();
  for (const [kind, filename] of Object.entries(schemaFiles) as Array<[SchemaKind, string]>) {
    const schema = JSON.parse(
      readFileSync(resolve(repositoryRoot, "protocol", "schemas", filename), "utf8"),
    ) as object;
    compiled.set(kind, ajv.compile(schema));
  }
  return (kind, value) => {
    const validate = compiled.get(kind);
    if (validate === undefined || !validate(value)) {
      throw new ProtocolValidationError(`structural ${kind} validation failed: ${describeErrors(validate?.errors)}`);
    }
  };
}
