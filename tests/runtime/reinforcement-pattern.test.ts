import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { evaluatePolicy } from "../../src/reinforcement/policy.js";
import type { AuthoritativeSessionEvidence, Document } from "../../src/reinforcement/types.js";

const fixture = JSON.parse(readFileSync(
  resolve(process.cwd(), "tests/runtime/fixtures/reinforcement/pattern-chain.json"),
  "utf8",
)) as Document;

function materialize(item: Document): AuthoritativeSessionEvidence {
  const resourceHash = item.resource === "transfer" ? fixture.transfer_resource_hash : fixture.source_resource_hash;
  const intervention = item.intervention_ref === undefined ? [] : [{
    evidenceRef: item.intervention_ref,
    occurredAt: item.intervention_at,
    skillId: fixture.skill_id,
    errorPatternId: fixture.error_pattern_id,
  }];
  return {
    sessionId: item.session_id,
    runId: "run-pattern-chain",
    segmentId: `segment-${item.session_id}`,
    packageId: `package-${item.session_id}`,
    state: "COMPLETED",
    completedAt: item.completed_at,
    objective: "Break the recurring evidence-boundary error",
    targetSkills: [fixture.skill_id],
    hypothesisRefs: [fixture.error_pattern_id],
    evidenceClass: item.evidence_class,
    hasLegitimateParticipation: true,
    clockAnomaly: false,
    completionEvidenceRef: `complete-${item.session_id}`,
    observations: [{
      evidenceRef: item.evidence_ref,
      sessionId: item.session_id,
      occurredAt: item.completed_at,
      outcome: item.outcome,
      skillId: fixture.skill_id,
      errorPatternId: fixture.error_pattern_id,
      evidenceClass: item.evidence_class,
      pedagogicalIntent: item.intent,
      materialHash: resourceHash,
      resourceHashes: [resourceHash],
    }],
    interventions: intervention,
    interventionEvidenceRefs: intervention.map((entry) => entry.evidenceRef),
    attemptedTransferEvidenceRefs: item.intent === "transfer" ? [item.evidence_ref] : [],
  };
}

describe("PATTERN_BROKEN 0.1.0", () => {
  it("requires the complete cross-session chain and creates a protocol-valid historical award without a mastery claim", () => {
    const sessions = fixture.sessions.map(materialize);
    const evaluation = evaluatePolicy({
      learnerId: fixture.learner_id,
      targetSessionId: "session-pattern-transfer",
      sessions,
      evaluatedAt: "2026-08-24T13:00:00.000Z",
    });

    expect(evaluation.eligible.map((item) => item.event_type)).toContain("PATTERN_BROKEN");
    expect(evaluation.historicalDecision).toMatchObject({
      policy_version: "0.1.0",
      decision_type: "historical_award",
      learner_id: fixture.learner_id,
      skill_id: fixture.skill_id,
      error_pattern_id: fixture.error_pattern_id,
      qualification: "confirmed",
      supersedes: null,
    });
    expect(evaluation.historicalDecision!.evidence_chain).toMatchObject({
      recurring_weakness: [{ session_id: "session-pattern-1" }, { session_id: "session-pattern-2" }],
      targeted_intervention: { evidence_ref: "evidence-targeted-intervention" },
      repeated_improvement: [{ session_id: "session-pattern-3" }, { session_id: "session-pattern-4" }],
      delayed_retrieval: { evidence_ref: "evidence-delayed-retrieval", delay_seconds: 180000 },
      transfer: {
        evidence_ref: "evidence-changed-material-transfer",
        source_resource_hash: fixture.source_resource_hash,
        transfer_resource_hash: fixture.transfer_resource_hash,
      },
    });
    expect(evaluation.claims_mastery).toBe(false);
  });

  it("preserves the historical award and emits a revoking current qualification after contradictory assessment", () => {
    const first = evaluatePolicy({
      learnerId: fixture.learner_id,
      targetSessionId: "session-pattern-transfer",
      sessions: fixture.sessions.map(materialize),
      evaluatedAt: "2026-08-24T13:00:00.000Z",
    });
    const allSessions = [...fixture.sessions, fixture.contradiction].map(materialize);
    const later = evaluatePolicy({
      learnerId: fixture.learner_id,
      targetSessionId: "session-pattern-assessment",
      sessions: allSessions,
      evaluatedAt: "2026-08-25T10:00:00.000Z",
      existingHistoricalAward: first.historicalDecision!,
    });

    expect(later.historicalDecision).toEqual(first.historicalDecision);
    expect(later.qualificationUpdate).toMatchObject({
      decision_type: "qualification_update",
      qualification: "revoked",
      supersedes: first.historicalDecision!.decision_id,
      evidence_chain: { regression_evidence_refs: ["evidence-assessment-regression"] },
    });
    expect(later.currentQualification).toMatchObject({ qualification: "revoked" });

    const repeated = evaluatePolicy({
      learnerId: fixture.learner_id,
      targetSessionId: "session-pattern-assessment",
      sessions: allSessions,
      evaluatedAt: "2026-08-25T10:00:00.000Z",
      existingHistoricalAward: first.historicalDecision!,
      existingCurrentQualification: later.currentQualification!,
    });
    expect(repeated.qualificationUpdate).toBeUndefined();
    expect(repeated.currentQualification).toEqual(later.currentQualification);

    const secondRegression = materialize({
      ...fixture.contradiction,
      session_id: "session-pattern-assessment-2",
      completed_at: "2026-08-26T10:00:00.000Z",
      evidence_ref: "evidence-assessment-regression-2",
    });
    const newest = evaluatePolicy({
      learnerId: fixture.learner_id,
      targetSessionId: secondRegression.sessionId,
      sessions: [...allSessions, secondRegression],
      evaluatedAt: "2026-08-26T10:00:00.000Z",
      existingHistoricalAward: first.historicalDecision!,
      existingCurrentQualification: later.currentQualification!,
    });
    const batched = evaluatePolicy({
      learnerId: fixture.learner_id,
      targetSessionId: secondRegression.sessionId,
      sessions: [...allSessions, secondRegression],
      evaluatedAt: "2026-08-26T10:00:00.000Z",
      existingHistoricalAward: first.historicalDecision!,
    });
    expect(newest.qualificationUpdate).toEqual(batched.qualificationUpdate);
    expect(newest.qualificationUpdate?.supersedes).toBe(first.historicalDecision?.decision_id);
  });

  it("uses the final transfer session identity and rejects out-of-order or contradicted chains", () => {
    const sessions = fixture.sessions.map(materialize);
    sessions.at(-1)!.completedAt = "2026-08-24T13:05:00.000Z";
    const valid = evaluatePolicy({
      learnerId: fixture.learner_id,
      targetSessionId: "session-pattern-transfer",
      sessions,
      evaluatedAt: "2026-08-24T14:00:00.000Z",
    });
    expect(valid.eligible.map((item) => item.event_type)).toContain("PATTERN_BROKEN");

    const outOfOrder = fixture.sessions.map(materialize);
    outOfOrder.at(-1)!.completedAt = "2026-08-23T11:00:00.000Z";
    outOfOrder.at(-1)!.observations[0]!.occurredAt = "2026-08-23T11:00:00.000Z";
    const invalid = evaluatePolicy({ learnerId: fixture.learner_id, targetSessionId: "session-pattern-transfer", sessions: outOfOrder, evaluatedAt: "2026-08-24T14:00:00.000Z" });
    expect(invalid.rejected).toContainEqual({ event_type: "PATTERN_BROKEN", reason: "complete_pattern_chain_not_proven" });

    const contradicted = fixture.sessions.map(materialize);
    const contradiction = materialize({ ...fixture.contradiction, completed_at: "2026-08-24T12:30:00.000Z" });
    contradiction.observations[0]!.occurredAt = "2026-08-24T12:30:00.000Z";
    const blocked = evaluatePolicy({ learnerId: fixture.learner_id, targetSessionId: "session-pattern-transfer", sessions: [...contradicted, contradiction], evaluatedAt: "2026-08-24T14:00:00.000Z" });
    expect(blocked.rejected).toContainEqual({ event_type: "PATTERN_BROKEN", reason: "complete_pattern_chain_not_proven" });
  });

  it("rejects a chain whose intervention timestamp comes from an anomalous session", () => {
    const sessions = fixture.sessions.map(materialize);
    sessions[2]!.clockAnomaly = true;
    const extra = materialize({ ...fixture.sessions[3], session_id: "session-pattern-4b", completed_at: "2026-08-23T11:00:00.000Z", evidence_ref: "evidence-pattern-improvement-2b" });
    const evaluation = evaluatePolicy({ learnerId: fixture.learner_id, targetSessionId: "session-pattern-transfer", sessions: [...sessions, extra], evaluatedAt: "2026-08-24T14:00:00.000Z" });
    expect(evaluation.rejected).toContainEqual({ event_type: "PATTERN_BROKEN", reason: "complete_pattern_chain_not_proven" });
  });

  it("does not award repeated easy evidence, a Coach claim, self-rating, or a delayed observation below 86,400 seconds", () => {
    const sessions = fixture.sessions.map(materialize);
    sessions[4]!.observations[0]!.occurredAt = "2026-08-23T09:59:59.000Z";
    sessions[4]!.completedAt = "2026-08-23T09:59:59.000Z";
    sessions[0]!.observations[0]!.sessionId = "session-pattern-1";
    sessions[1]!.observations[0]!.sessionId = "session-pattern-1";
    const evaluation = evaluatePolicy({
      learnerId: fixture.learner_id,
      targetSessionId: "session-pattern-transfer",
      sessions,
      evaluatedAt: "2026-08-24T13:00:00.000Z",
    });

    expect(evaluation.eligible.map((item) => item.event_type)).not.toContain("PATTERN_BROKEN");
    expect(evaluation.rejected).toContainEqual({ event_type: "PATTERN_BROKEN", reason: "complete_pattern_chain_not_proven" });
  });
});
