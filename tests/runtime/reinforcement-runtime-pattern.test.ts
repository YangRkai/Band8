import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalHash } from "../../src/protocol/canonical.js";
import { Band8Runtime } from "../../src/runtime/runtime.js";
import { storageKey } from "../../src/storage/workspace.js";

type Document = Record<string, any>;

const repositoryRoot = resolve(process.cwd());
const basePackage = JSON.parse(readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/training-package.json"), "utf8")) as Document;
const baseProtected = JSON.parse(readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/protected-evaluation.json"), "utf8")) as Document;
const workspaces: string[] = [];

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "band8-runtime-pattern-"));
  workspaces.push(path);
  return path;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function fixture(
  suffix: string,
  evidenceClass: "training_performance" | "transfer_performance" | "assessment_performance",
  intent: "retrieval" | "correction" | "transfer",
  material: "source" | "transfer",
): { packageText: string; protectedText: string; packageId: string } {
  const packageDocument = structuredClone(basePackage);
  const evaluation = structuredClone(baseProtected);
  packageDocument.package_id = `pkg-runtime-pattern-${suffix}`;
  packageDocument.run_id = "run-runtime-pattern";
  packageDocument.segment_id = `segment-runtime-pattern-${suffix}`;
  packageDocument.created_at = "2026-08-20T00:00:00Z";
  packageDocument.session_intent = {
    mode: evidenceClass === "assessment_performance" ? "assessment" : "training",
    objective: "Resolve the recurring Not Given evidence-boundary pattern.",
    evidence_class: evidenceClass,
  };
  packageDocument.feedback_policy = evidenceClass === "assessment_performance"
    ? { mode: "assessment", allow_hints: false, allow_retry: false, correction_timing: "none" }
    : { mode: "training", allow_hints: false, allow_retry: false, correction_timing: "none" };
  packageDocument.target_skills = ["reading.not-given"];
  packageDocument.training_hypotheses = [{ hypothesis_id: "hypothesis-runtime-not-given-boundary", purpose: "test" }];
  const content = material === "source" ? "Source material for the recurring evidence boundary." : "Changed transfer material for the same evidence boundary.";
  packageDocument.resources[0].content = content;
  packageDocument.resources[0].provenance.content_hash = sha256(content);
  for (const activity of packageDocument.activities) {
    activity.skill_refs = ["reading.not-given"];
    if (activity.type === "SELECT") activity.pedagogical_intent = intent;
    if (evidenceClass === "assessment_performance") activity.feedback = { timing: "none", allowed: [] };
  }
  evaluation.evaluation_id = `evaluation-runtime-pattern-${suffix}`;
  evaluation.package_id = packageDocument.package_id;
  evaluation.content_hash = canonicalHash(evaluation.entries);
  packageDocument.protected_evaluation_ref = {
    evaluation_id: evaluation.evaluation_id,
    content_hash: evaluation.content_hash,
  };
  evaluation.package_hash = canonicalHash(packageDocument);
  return {
    packageText: JSON.stringify(packageDocument),
    protectedText: JSON.stringify(evaluation),
    packageId: packageDocument.package_id,
  };
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("real Runtime PATTERN_BROKEN chain", () => {
  it("publishes once, survives restart/rebuild, and preserves award while later assessment revokes current qualification", () => {
    const path = workspace();
    let event = 0;
    const common = {
      repositoryRoot,
      workspacePath: path,
      learnerId: "learner-runtime-pattern",
      eventIdFactory: () => `event-runtime-pattern-${++event}`,
    };
    const run = (
      suffix: string,
      timestamp: string,
      evidenceClass: "training_performance" | "transfer_performance" | "assessment_performance",
      intent: "retrieval" | "correction" | "transfer",
      material: "source" | "transfer",
      successful: boolean,
    ): Band8Runtime => {
      let second = 0;
      const runtime = Band8Runtime.open({
        ...common,
        now: () => new Date(Date.parse(timestamp) + second++ * 1000).toISOString(),
      });
      if (runtime.learningTimezone() === undefined) runtime.configureLearningTimezone("UTC");
      const documents = fixture(suffix, evidenceClass, intent, material);
      runtime.importPackage(documents.packageText, documents.protectedText);
      const sessionId = `session-runtime-pattern-${suffix}`;
      runtime.createSession(documents.packageId, sessionId);
      runtime.startSession(sessionId);
      runtime.completeCurrentActivity(sessionId);
      runtime.completeCurrentActivity(sessionId);
      runtime.completeCurrentActivity(sessionId, { optionIds: [successful ? "true" : "false"] });
      runtime.completeCurrentActivity(sessionId, { optionIds: [successful ? "not-given" : "true"] });
      return runtime;
    };

    run("failure-1", "2026-08-20T10:00:00Z", "training_performance", "retrieval", "source", false);
    run("failure-2", "2026-08-21T10:00:00Z", "training_performance", "retrieval", "source", false);
    run("intervention", "2026-08-22T10:00:00Z", "training_performance", "correction", "source", true);
    run("improvement", "2026-08-23T10:00:00Z", "training_performance", "retrieval", "source", true);
    run("delayed", "2026-08-24T12:00:00Z", "training_performance", "retrieval", "source", true);
    let runtime = run("transfer", "2026-08-24T13:00:00Z", "transfer_performance", "transfer", "transfer", true);
    const targetSession = "session-runtime-pattern-transfer";
    const targetEventsPath = join(path, "sessions", storageKey(targetSession), "events.ndjson");
    const rawHash = createHash("sha256").update(readFileSync(targetEventsPath)).digest("hex");

    const awarded = runtime.evaluateReinforcement(targetSession);
    expect(awarded.eligible.map((item) => item.event_type)).toContain("PATTERN_BROKEN");
    expect(runtime.reveal(targetSession).primary_event?.event_type).toBe("PATTERN_BROKEN");
    expect(awarded.historicalDecision).toMatchObject({ decision_type: "historical_award", qualification: "confirmed" });
    const historical = awarded.historicalDecision;
    expect(readdirSync(join(path, "reinforcement", "decisions"))).toHaveLength(1);

    runtime.rebuildResult(targetSession);
    runtime = Band8Runtime.open({ ...common, now: () => "2026-08-24T14:00:00Z" });
    expect(runtime.evaluateReinforcement(targetSession).historicalDecision).toEqual(historical);
    expect(readdirSync(join(path, "reinforcement", "decisions"))).toHaveLength(1);
    expect(createHash("sha256").update(readFileSync(targetEventsPath)).digest("hex")).toBe(rawHash);

    runtime = run("assessment", "2026-08-25T10:00:00Z", "assessment_performance", "retrieval", "transfer", false);
    const revoked = runtime.evaluateReinforcement("session-runtime-pattern-assessment");
    expect(revoked.historicalDecision).toEqual(historical);
    expect(revoked.currentQualification).toMatchObject({ qualification: "revoked" });
    expect(readdirSync(join(path, "reinforcement", "decisions"))).toHaveLength(2);

    runtime = Band8Runtime.open({ ...common, now: () => "2026-08-22T00:00:00Z" });
    expect(runtime.evaluateReinforcement(targetSession).currentQualification).toMatchObject({ qualification: "revoked" });
    expect(readdirSync(join(path, "reinforcement", "decisions"))).toHaveLength(2);
  });
});
