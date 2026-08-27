import { describe, expect, it } from "vitest";

import { reinforcementIdentity } from "../../src/reinforcement/identity.js";
import { evaluatePolicy as evaluateRuntimePolicy, type PolicyInput } from "../../src/reinforcement/policy.js";
import type { AuthoritativeSessionEvidence } from "../../src/reinforcement/types.js";
import { testLearningCalendar } from "./helpers/learning-timezone.js";

function evaluatePolicy(input: Omit<PolicyInput, "learningDays" | "learningTimezone">): ReturnType<typeof evaluateRuntimePolicy> {
  return evaluateRuntimePolicy({ ...input, ...testLearningCalendar(input.sessions) });
}

function session(
  id: string,
  completedAt: string,
  evidenceClass: AuthoritativeSessionEvidence["evidenceClass"],
  resourceHash: string,
  overrides: Partial<AuthoritativeSessionEvidence> = {},
): AuthoritativeSessionEvidence {
  return {
    sessionId: id,
    runId: "run-policy",
    segmentId: `segment-${id}`,
    packageId: `package-${id}`,
    state: "COMPLETED",
    completedAt,
    objective: "Apply the evidence boundary",
    targetSkills: ["reading.not-given"],
    hypothesisRefs: ["hypothesis-reading-boundary"],
    evidenceClass,
    hasLegitimateParticipation: true,
    clockAnomaly: false,
    completionEvidenceRef: `complete-${id}`,
    observations: [{
      evidenceRef: `answer-${id}`,
      sessionId: id,
      occurredAt: completedAt,
      outcome: "successful",
      skillId: "reading.not-given",
      errorPatternId: "hypothesis-reading-boundary",
      evidenceClass,
      pedagogicalIntent: evidenceClass === "transfer_performance" ? "transfer" : "retrieval",
      materialHash: resourceHash,
      resourceHashes: [resourceHash],
    }],
    interventions: [],
    interventionEvidenceRefs: [],
    attemptedTransferEvidenceRefs: [],
    ...overrides,
  };
}

const hashA = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const hashB = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

describe("deterministic reinforcement policy", () => {
  it("projects completion, mission advance, streak, delayed retention, and changed-material transfer from authoritative facts", () => {
    const prior = session("prior", "2026-08-25T10:00:00.000Z", "training_performance", hashA);
    const target = session("target", "2026-08-27T11:00:00.000Z", "transfer_performance", hashB);
    const evaluation = evaluatePolicy({
      learnerId: "learner-one",
      targetSessionId: target.sessionId,
      sessions: [prior, target],
      evaluatedAt: "2026-08-27T12:00:00.000Z",
    });

    expect(evaluation.eligible.map((item) => item.event_type)).toEqual([
      "SESSION_COMPLETE",
      "MISSION_ADVANCED",
      "TRANSFER_CONFIRMED",
      "STREAK_EXTENDED",
    ]);
    expect(evaluation.rejected).toContainEqual({ event_type: "RETENTION_CONFIRMED", reason: "delayed_retrieval_not_proven" });
    expect(evaluation.rejected).toContainEqual({ event_type: "PERSONAL_BEST", reason: "no_comparable_objective_metric" });
    expect(evaluation.claims_mastery).toBe(false);
  });

  it("confirms retention only for delayed retrieval with a non-anomalous earlier success", () => {
    const prior = session("prior", "2026-08-25T10:00:00.000Z", "training_performance", hashA);
    const target = session("target", "2026-08-27T11:00:00.000Z", "training_performance", hashA);
    const eligible = evaluatePolicy({ learnerId: "learner-one", targetSessionId: "target", sessions: [prior, target], evaluatedAt: "2026-08-27T12:00:00.000Z" });
    expect(eligible.eligible.map((item) => item.event_type)).toContain("RETENTION_CONFIRMED");

    target.observations[0]!.pedagogicalIntent = "practice";
    const wrongIntent = evaluatePolicy({ learnerId: "learner-one", targetSessionId: "target", sessions: [prior, target], evaluatedAt: "2026-08-27T12:00:00.000Z" });
    expect(wrongIntent.rejected).toContainEqual({ event_type: "RETENTION_CONFIRMED", reason: "delayed_retrieval_not_proven" });

    target.observations[0]!.pedagogicalIntent = "retrieval";
    prior.clockAnomaly = true;
    const anomalousBaseline = evaluatePolicy({ learnerId: "learner-one", targetSessionId: "target", sessions: [prior, target], evaluatedAt: "2026-08-27T12:00:00.000Z" });
    expect(anomalousBaseline.rejected).toContainEqual({ event_type: "RETENTION_CONFIRMED", reason: "delayed_retrieval_not_proven" });
  });

  it("never uses future sessions or absent/ambiguous material identity to confirm an older transfer", () => {
    const target = session("target", "2026-08-25T10:00:00.000Z", "transfer_performance", hashB);
    const future = session("future", "2026-08-27T10:00:00.000Z", "training_performance", hashA);
    const fromFuture = evaluatePolicy({ learnerId: "learner-one", targetSessionId: "target", sessions: [target, future], evaluatedAt: "2026-08-28T00:00:00.000Z" });
    expect(fromFuture.rejected).toContainEqual({ event_type: "TRANSFER_CONFIRMED", reason: "changed_material_not_proven" });

    const prior = session("prior", "2026-08-24T10:00:00.000Z", "training_performance", hashA);
    target.observations[0]!.resourceHashes = [];
    delete target.observations[0]!.materialHash;
    const empty = evaluatePolicy({ learnerId: "learner-one", targetSessionId: "target", sessions: [prior, target], evaluatedAt: "2026-08-25T12:00:00.000Z" });
    expect(empty.rejected).toContainEqual({ event_type: "TRANSFER_CONFIRMED", reason: "changed_material_not_proven" });

    prior.observations[0]!.resourceHashes = [hashA, "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"];
    target.observations[0]!.resourceHashes = [hashA, hashB];
    delete prior.observations[0]!.materialHash;
    delete target.observations[0]!.materialHash;
    const ambiguous = evaluatePolicy({ learnerId: "learner-one", targetSessionId: "target", sessions: [prior, target], evaluatedAt: "2026-08-25T12:00:00.000Z" });
    expect(ambiguous.rejected).toContainEqual({ event_type: "TRANSFER_CONFIRMED", reason: "changed_material_not_proven" });
  });

  it("requires a trustworthy earlier observation and a previously unseen transfer material", () => {
    const target = session("target", "2026-08-25T10:00:00.000Z", "transfer_performance", hashB);
    const laterObservation = session("prior", "2026-08-25T09:00:00.000Z", "training_performance", hashA);
    laterObservation.observations[0]!.occurredAt = "2026-08-25T10:00:01.000Z";
    expect(evaluatePolicy({ learnerId: "learner-one", targetSessionId: "target", sessions: [laterObservation, target], evaluatedAt: "2026-08-25T11:00:00.000Z" }).eligible)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ event_type: "TRANSFER_CONFIRMED" })]));

    laterObservation.observations[0]!.occurredAt = "2026-08-25T09:00:00.000Z";
    laterObservation.clockAnomaly = true;
    expect(evaluatePolicy({ learnerId: "learner-one", targetSessionId: "target", sessions: [laterObservation, target], evaluatedAt: "2026-08-25T11:00:00.000Z" }).eligible)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ event_type: "TRANSFER_CONFIRMED" })]));

    const trained = session("trained", "2026-08-23T09:00:00.000Z", "training_performance", hashA);
    const firstTransfer = session("first-transfer", "2026-08-24T09:00:00.000Z", "transfer_performance", hashB);
    expect(evaluatePolicy({ learnerId: "learner-one", targetSessionId: "target", sessions: [trained, firstTransfer, target], evaluatedAt: "2026-08-25T11:00:00.000Z" }).rejected)
      .toContainEqual({ event_type: "TRANSFER_CONFIRMED", reason: "changed_material_not_proven" });

    const sameSessionExposure = session("same-session", "2026-08-25T10:00:00.000Z", "transfer_performance", hashB);
    sameSessionExposure.observations.unshift({
      ...sameSessionExposure.observations[0]!,
      evidenceRef: "answer-same-session-practice",
      occurredAt: "2026-08-25T09:59:00.000Z",
      evidenceClass: "training_performance",
      pedagogicalIntent: "practice",
    });
    expect(evaluatePolicy({ learnerId: "learner-one", targetSessionId: "same-session", sessions: [trained, sameSessionExposure], evaluatedAt: "2026-08-25T11:00:00.000Z" }).rejected)
      .toContainEqual({ event_type: "TRANSFER_CONFIRMED", reason: "changed_material_not_proven" });
  });

  it("derives the same semantic identity from the same sorted evidence set and policy", () => {
    const left = reinforcementIdentity("0.1.0", "TRANSFER_CONFIRMED", ["evidence-b", "evidence-a"]);
    const right = reinforcementIdentity("0.1.0", "TRANSFER_CONFIRMED", ["evidence-a", "evidence-b"]);
    expect(left).toBe(right);
    expect(left).toMatch(/^reward-[0-9a-f]{32}$/u);
  });

  it("rejects same-resource transfer, login-only completion, and anomalous delayed time", () => {
    const prior = session("prior", "2026-08-25T10:00:00.000Z", "training_performance", hashA);
    const target = session("target", "2026-08-27T11:00:00.000Z", "transfer_performance", hashA, {
      hasLegitimateParticipation: false,
      clockAnomaly: true,
    });
    const evaluation = evaluatePolicy({
      learnerId: "learner-one",
      targetSessionId: target.sessionId,
      sessions: [prior, target],
      evaluatedAt: "2026-08-27T12:00:00.000Z",
    });

    expect(evaluation.eligible).toEqual([]);
    expect(evaluation.rejected).toEqual(expect.arrayContaining([
      { event_type: "SESSION_COMPLETE", reason: "no_legitimate_learner_participation" },
      { event_type: "TRANSFER_CONFIRMED", reason: "changed_material_not_proven" },
      { event_type: "RETENTION_CONFIRMED", reason: "clock_anomaly" },
    ]));
  });
});
