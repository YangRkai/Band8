import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { projectMission } from "../../src/reinforcement/mission.js";
import { projectEffectiveStreak } from "../../src/reinforcement/streak.js";
import type { AuthoritativeSessionEvidence } from "../../src/reinforcement/types.js";

type Document = Record<string, any>;

const packageDocument = JSON.parse(readFileSync(
  resolve(process.cwd(), "tests/runtime/fixtures/writing-golden/package-b.json"),
  "utf8",
)) as Document;

function evidence(sessionId: string, completedAt: string, overrides: Partial<AuthoritativeSessionEvidence> = {}): AuthoritativeSessionEvidence {
  return {
    sessionId,
    runId: "run-one",
    segmentId: `segment-${sessionId}`,
    packageId: `package-${sessionId}`,
    state: "COMPLETED",
    completedAt,
    objective: "Target objective",
    targetSkills: ["reading.not-given"],
    hypothesisRefs: ["hypothesis-reading-boundary"],
    evidenceClass: "training_performance",
    hasLegitimateParticipation: true,
    clockAnomaly: false,
    completionEvidenceRef: `event-complete-${sessionId}`,
    observations: [],
    interventions: [],
    interventionEvidenceRefs: [],
    attemptedTransferEvidenceRefs: [],
    ...overrides,
  };
}

describe("current mission projection", () => {
  it.each([
    ["READY", undefined, undefined, "OPEN"],
    ["RUNNING", undefined, undefined, "IN_PROGRESS"],
    ["AWAITING_COACH", undefined, undefined, "EVIDENCE_PENDING"],
    ["COMPLETED", evidence("subjective", "2026-08-27T09:00:00.000Z"), undefined, "EVIDENCE_PENDING"],
    ["COMPLETED", evidence("success", "2026-08-27T09:00:00.000Z", {
      observations: [{
        evidenceRef: "answer-success",
        sessionId: "success",
        occurredAt: "2026-08-27T08:59:00.000Z",
        outcome: "successful",
        skillId: "writing.task-response",
        errorPatternId: "hypothesis-writing-golden-task-response",
        evidenceClass: "training_performance",
        pedagogicalIntent: "retrieval",
        resourceHashes: ["sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      }],
    }), undefined, "VALIDATION_PENDING"],
    ["COMPLETED", evidence("closed", "2026-08-27T09:00:00.000Z"), {
      qualification: "confirmed",
      skill_id: "writing.task-response",
      error_pattern_id: "hypothesis-writing-golden-task-response",
    }, "CLOSED"],
  ])("maps %s evidence to %s", (state, sessionEvidence, qualification, expected) => {
    const mission = projectMission(packageDocument, { state }, sessionEvidence, qualification);
    expect(mission.status).toBe(expected);
    expect(mission).toMatchObject({
      objective: packageDocument.session_intent.objective,
      target_skills: packageDocument.target_skills,
      hypothesis_refs: ["hypothesis-writing-golden-task-response"],
    });
    expect(JSON.stringify(mission)).not.toMatch(/reward|threshold|mastery|band_progress/iu);
  });

  it("does not close a mission with a confirmed qualification for another skill or pattern", () => {
    const current = evidence("current", "2026-08-27T09:00:00.000Z", {
      observations: [{
        evidenceRef: "answer-current",
        sessionId: "current",
        occurredAt: "2026-08-27T08:59:00.000Z",
        outcome: "successful",
        skillId: "writing.task-response",
        errorPatternId: "hypothesis-writing-golden-task-response",
        evidenceClass: "training_performance",
        pedagogicalIntent: "retrieval",
        resourceHashes: ["sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      }],
    });
    expect(projectMission(packageDocument, { state: "COMPLETED" }, current, {
      qualification: "confirmed",
      skill_id: "reading.not-given",
      error_pattern_id: "hypothesis-reading-other",
    }).status).toBe("VALIDATION_PENDING");
  });

  it("projects the frozen learner goal without inventing band progress", () => {
    const assessment = evidence("assessment", "2026-08-27T09:00:00.000Z", {
      evidenceClass: "assessment_performance",
      observations: [{
        evidenceRef: "answer-assessment",
        sessionId: "assessment",
        occurredAt: "2026-08-27T08:59:00.000Z",
        outcome: "unsuccessful",
        skillId: "writing.task-response",
        errorPatternId: "hypothesis-writing-golden-task-response",
        evidenceClass: "assessment_performance",
        pedagogicalIntent: "assessment",
        resourceHashes: ["sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
      }],
    });
    const mission = projectMission(packageDocument, { state: "COMPLETED" }, assessment, {
      qualification: "revoked",
      skill_id: "writing.task-response",
      error_pattern_id: "hypothesis-writing-golden-task-response",
    });

    expect(mission.goal).toEqual({
      overall_target: 8,
      section_minimums: { listening: 7.5, reading: 7.5, speaking: 7.5, writing: 7.5 },
      unresolved_blockers: ["hypothesis-writing-golden-task-response"],
      validated_qualifications: [{
        error_pattern_id: "hypothesis-writing-golden-task-response",
        qualification: "revoked",
        skill_id: "writing.task-response",
      }],
      assessment_evidence_refs: ["answer-assessment"],
    });
    expect(JSON.stringify(mission.goal)).not.toMatch(/progress|percent|distance/iu);
  });
});

describe("effective training streak", () => {
  it("counts one authoritative participating day once and ignores login-like, duplicate, quarantined, and anomalous evidence", () => {
    const dayOne = evidence("one", "2026-08-25T10:00:00.000Z");
    const sameDay = evidence("two", "2026-08-25T20:00:00.000Z");
    const dayTwo = evidence("three", "2026-08-26T10:00:00.000Z");
    const loginOnly = evidence("login", "2026-08-27T10:00:00.000Z", { hasLegitimateParticipation: false });
    const anomalous = evidence("anomaly", "2026-08-27T11:00:00.000Z", { clockAnomaly: true });

    const projection = projectEffectiveStreak([dayOne, sameDay, dayTwo, dayOne, loginOnly, anomalous], "2026-08-27T12:00:00.000Z");

    expect(projection).toEqual({
      policy_version: "0.1.0",
      day_boundary: "UTC",
      effective_days: ["2026-08-25", "2026-08-26"],
      current_streak: 2,
      best_streak: 2,
      total_effective_days: 2,
    });
  });

  it("ends only the current streak after a gap while preserving best and total history", () => {
    const projection = projectEffectiveStreak([
      evidence("one", "2026-08-20T10:00:00.000Z"),
      evidence("two", "2026-08-21T10:00:00.000Z"),
      evidence("three", "2026-08-23T10:00:00.000Z"),
    ], "2026-08-27T12:00:00.000Z");

    expect(projection.current_streak).toBe(0);
    expect(projection.best_streak).toBe(2);
    expect(projection.total_effective_days).toBe(3);
  });

  it("normalizes RFC 3339 offsets to the UTC day boundary", () => {
    const projection = projectEffectiveStreak([
      evidence("offset", "2026-08-27T00:30:00+08:00"),
      evidence("utc", "2026-08-26T18:00:00Z"),
    ], "2026-08-27T00:00:00Z");
    expect(projection.effective_days).toEqual(["2026-08-26"]);
    expect(projection.total_effective_days).toBe(1);
  });
});
