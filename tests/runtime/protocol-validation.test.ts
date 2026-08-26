import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createProtocolValidator, ProtocolValidationError } from "../../src/protocol/validator.js";

const root = resolve(process.cwd());
const validator = createProtocolValidator(root);

function json(path: string): unknown {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function ndjson(path: string): unknown[] {
  return readFileSync(resolve(root, path), "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

describe("Band8 package validation", () => {
  it("accepts a schema-valid package whose cross-document references and provenance resolve", () => {
    expect(
      validator.validatePackage(json("tests/protocol/fixtures/valid/minimal-training-package.json")),
    ).toEqual({ identity: "accepted" });
  });

  it("treats instruction-like learning content as inert data", () => {
    expect(() =>
      validator.validatePackage(json("tests/protocol/fixtures/adversarial/malicious-instruction-as-data.json")),
    ).not.toThrow();
  });

  it("rejects content changed without its provenance hash", () => {
    const packageDocument = json("tests/protocol/fixtures/valid/minimal-training-package.json") as Record<string, any>;
    packageDocument.resources[0].content += " changed";
    expect(() => validator.validatePackage(packageDocument)).toThrow(ProtocolValidationError);
  });

  it("validates the protected plane against package identity and entry integrity", () => {
    const packageDocument = json("tests/protocol/fixtures/valid/assessment-training-package.json");
    const evaluation = json("tests/protocol/fixtures/valid/protected-evaluation.json");
    expect(() => validator.validateProtectedEvaluation(evaluation, packageDocument)).not.toThrow();
  });

  it("rejects a package that leaks assessment answers into learner-visible data", () => {
    expect(() =>
      validator.validatePackage(json("tests/protocol/fixtures/adversarial/assessment-answer-leakage.json")),
    ).toThrow(ProtocolValidationError);
  });
});

describe("Band8 event validation", () => {
  const packageDocument = json("tests/protocol/fixtures/valid/minimal-training-package.json");

  it("accepts a contiguous nonterminal stream only in prefix mode", () => {
    const events = ndjson("tests/protocol/fixtures/adversarial/valid-incomplete-event-prefix.ndjson");
    expect(validator.validateEventStream(events, { packageDocument, mode: "prefix" }).state).toBe(
      "VALID_INCOMPLETE",
    );
    expect(() => validator.validateEventStream(events, { packageDocument, mode: "complete" })).toThrow(
      ProtocolValidationError,
    );
  });

  it("rejects duplicate resume operations", () => {
    const events = ndjson("tests/protocol/fixtures/adversarial/duplicate-resume.ndjson");
    expect(() => validator.validateEventStream(events, { packageDocument, mode: "complete" })).toThrow(
      /duplicate resume operation/u,
    );
  });

  it("rejects typed-payload and activity-context violations", () => {
    for (const path of [
      "tests/protocol/fixtures/adversarial/typed-event-invalid-payload.ndjson",
      "tests/protocol/fixtures/adversarial/unknown-activity.ndjson",
    ]) {
      expect(() =>
        validator.validateEventStream(ndjson(path), { packageDocument, mode: "complete" }),
      ).toThrow(ProtocolValidationError);
    }
  });

  it("keeps sequence truth across an explicitly recorded wall-clock rollback", () => {
    const events = ndjson("tests/protocol/fixtures/adversarial/clock-rollback.ndjson");
    expect(validator.validateEventStream(events, { packageDocument, mode: "complete" }).state).toBe(
      "COMPLETED",
    );
  });
});
