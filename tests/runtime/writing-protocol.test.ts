import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createProtocolValidator, ProtocolValidationError } from "../../src/protocol/validator.js";

type Document = Record<string, any>;

const root = resolve(process.cwd());
const fixtureRoot = resolve(root, "tests/protocol/fixtures/adversarial/writing-checkpoint");
const packageA = JSON.parse(readFileSync(join(fixtureRoot, "package-a.json"), "utf8")) as Document;
const packageB = JSON.parse(readFileSync(join(fixtureRoot, "package-b.json"), "utf8")) as Document;
const checkpoint = JSON.parse(readFileSync(join(fixtureRoot, "checkpoint.json"), "utf8")) as Document;
const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

function artifactFixture(): { root: string; metadata: Document } {
  const artifactRoot = mkdtempSync(join(tmpdir(), "band8-protocol-artifact-"));
  temporaryPaths.push(artifactRoot);
  mkdirSync(join(artifactRoot, "safe"), { recursive: true });
  const bytes = Buffer.from("learner draft", "utf8");
  writeFileSync(join(artifactRoot, "safe", "draft.txt"), bytes);
  return {
    root: artifactRoot,
    metadata: {
      schema_version: "0.1.0",
      protocol_version: "0.1.0",
      artifact_id: "artifact-writing-original-001",
      session_id: "session-writing-001",
      run_id: packageA.run_id,
      segment_id: packageA.segment_id,
      package_id: packageA.package_id,
      artifact_type: "essay",
      created_at: "2026-08-26T12:00:00Z",
      source_activity_id: "act-writing-original",
      content_hash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      relative_path: "safe/draft.txt",
    },
  };
}

function checkpointEvents(): Document[] {
  const context = {
    session_id: "session-writing-001",
    run_id: packageA.run_id,
    segment_id: packageA.segment_id,
    package_id: packageA.package_id,
  };
  const event = (sequence: number, eventType: string, activityId: string | null, payload: Document): Document => ({
    schema_version: "0.1.0",
    protocol_version: "0.1.0",
    event_id: `event-writing-${sequence}`,
    event_type: eventType,
    ...context,
    activity_id: activityId,
    timestamp: `2026-08-26T12:00:0${sequence}Z`,
    monotonic_offset_ms: (sequence - 1) * 1000,
    sequence_number: sequence,
    payload,
  });
  return [
    event(1, "session_started", null, { run_id: packageA.run_id, segment_id: packageA.segment_id, mode: "training" }),
    event(2, "activity_started", "act-writing-original", { attempt_id: "attempt-writing-original" }),
    event(3, "answer_submitted", "act-writing-original", { attempt_id: "attempt-writing-original", response_kind: "text", text_value: "learner draft", output_ref: "artifact-writing-original-001" }),
    event(4, "artifact_created", "act-writing-original", { artifact_id: "artifact-writing-original-001" }),
    event(5, "activity_completed", "act-writing-original", { attempt_id: "attempt-writing-original" }),
    event(6, "coach_checkpoint_reached", null, { checkpoint_id: "checkpoint-writing-001", required_evidence_refs: ["artifact-writing-original-001"] }),
  ];
}

describe("frozen Writing protocol surfaces", () => {
  const validator = createProtocolValidator(root);

  it("validates closed artifact metadata and rejects unsafe relative storage identity", () => {
    const { metadata } = artifactFixture();
    expect(() => validator.validateArtifact(metadata)).not.toThrow();
    expect(() => validator.validateArtifact({ ...metadata, relative_path: "../outside.txt" })).toThrow(/relative_path/iu);
  });

  it("binds checkpoint and continuation to the exact prior package context", () => {
    expect(() => validator.validateCheckpoint(checkpoint, packageA)).not.toThrow();
    expect(() => validator.validateContinuation(packageB, packageA, checkpoint)).not.toThrow();

    const wrongRun = structuredClone(packageB);
    wrongRun.run_id = "run-writing-wrong";
    expect(() => validator.validateContinuation(wrongRun, packageA, checkpoint)).toThrow(ProtocolValidationError);
    const reusedSegment = structuredClone(packageB);
    reusedSegment.segment_id = packageA.segment_id;
    expect(() => validator.validateContinuation(reusedSegment, packageA, checkpoint)).toThrow(ProtocolValidationError);
  });

  it("accepts an artifact event only when metadata, bytes, hash, and context resolve", () => {
    const fixture = artifactFixture();
    const artifacts = new Map([[fixture.metadata.artifact_id, fixture.metadata]]);
    expect(validator.validateEventStream(checkpointEvents(), {
      packageDocument: packageA,
      mode: "complete",
      artifacts,
      artifactRoot: fixture.root,
    }).state).toBe("AWAITING_COACH");

    expect(() => validator.validateEventStream(checkpointEvents(), {
      packageDocument: packageA,
      mode: "complete",
      artifacts: new Map(),
      artifactRoot: fixture.root,
    })).toThrow(/artifact/iu);
    writeFileSync(join(fixture.root, "safe", "draft.txt"), "tampered", "utf8");
    expect(() => validator.validateEventStream(checkpointEvents(), {
      packageDocument: packageA,
      mode: "complete",
      artifacts,
      artifactRoot: fixture.root,
    })).toThrow(/hash/iu);
  });

  it("rejects every factual artifact reference that does not resolve", () => {
    const fixture = artifactFixture();
    const artifacts = new Map([[fixture.metadata.artifact_id, fixture.metadata]]);
    const events = checkpointEvents();
    expect(() => validator.validateEventStream(events, {
      packageDocument: packageA,
      mode: "complete",
    })).toThrow(/artifact|context|metadata/iu);
    events[2]!.payload.output_ref = "artifact-missing-output";
    expect(() => validator.validateEventStream(events, {
      packageDocument: packageA,
      mode: "complete",
      artifacts,
      artifactRoot: fixture.root,
    })).toThrow(/artifact|output_ref/iu);
  });

  it("requires transfer and Coach feedback semantics for a continuation", () => {
    const transferRevision = structuredClone(packageB);
    transferRevision.activities[1].relationships.revision_of = "attempt-writing-original";
    transferRevision.activities[1].relationships.feedback_ref = "res-writing-feedback";
    transferRevision.activities[1].relationships.source_output_ref = "artifact-writing-original-001";
    expect(() => validator.validateContinuation(transferRevision, packageA, checkpoint)).toThrow(/transfer|revision/iu);

    const unchangedTransfer = structuredClone(packageB);
    unchangedTransfer.resources[1].content = packageA.resources[0].content;
    unchangedTransfer.resources[1].provenance.content_hash = packageA.resources[0].provenance.content_hash;
    expect(() => validator.validateContinuation(unchangedTransfer, packageA, checkpoint)).toThrow(/transfer|material|hash/iu);

    const unprovenFeedback = structuredClone(packageB);
    unprovenFeedback.resources[0].provenance.generator.producer = "Band8 Runtime";
    expect(() => validator.validateContinuation(unprovenFeedback, packageA, checkpoint)).toThrow(/feedback|Coach|provenance/iu);

    const nonCodexFeedback = structuredClone(packageB);
    nonCodexFeedback.generator.producer = "Untrusted Generator";
    nonCodexFeedback.resources[0].provenance.generator.producer = "Untrusted Generator";
    expect(() => validator.validateContinuation(nonCodexFeedback, packageA, checkpoint)).toThrow(/feedback|Coach|provenance/iu);
  });
});
