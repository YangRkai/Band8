import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { projectMission } from "../../src/reinforcement/mission.js";
import { projectEffectiveStreak } from "../../src/reinforcement/streak.js";
import type { AuthoritativeSessionEvidence } from "../../src/reinforcement/types.js";
import type {
  LearningDayRecord,
  LearningTimezoneEpoch,
  LearningTimezoneSettings,
} from "../../src/storage/learning-timezone-store.js";

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
  function epoch(id: string, timeZone: string, effectiveFrom: string): LearningTimezoneEpoch {
    return {
      timezone_epoch_id: id,
      learning_timezone: timeZone,
      effective_from: effectiveFrom,
      created_at: effectiveFrom,
    };
  }

  function settings(...epochs: LearningTimezoneEpoch[]): LearningTimezoneSettings {
    const current = epochs.at(-1)!;
    return {
      version: 1,
      learning_timezone: current.learning_timezone,
      timezone_epoch_id: current.timezone_epoch_id,
      epochs,
    };
  }

  function learningDay(sessionId: string, currentEpoch: LearningTimezoneEpoch, localDate: string): LearningDayRecord {
    return {
      version: 1,
      session_id: sessionId,
      completed_at: `${localDate}T12:00:00.000Z`,
      timezone_epoch_id: currentEpoch.timezone_epoch_id,
      learning_timezone: currentEpoch.learning_timezone,
      local_calendar_date: localDate,
      learning_day_id: `${currentEpoch.timezone_epoch_id}:${localDate}`,
      created_at: `${localDate}T12:01:00.000Z`,
    };
  }

  it("counts each stable learning-day identity once", () => {
    const current = epoch("timezone-epoch-shanghai", "Asia/Shanghai", "2026-08-20T00:00:00.000Z");
    const dayOne = learningDay("session-one", current, "2026-08-25");
    const sameDay = learningDay("session-two", current, "2026-08-25");
    const dayTwo = learningDay("session-three", current, "2026-08-26");

    const projection = projectEffectiveStreak([dayOne, sameDay, dayTwo, dayOne], "2026-08-27T12:00:00.000Z", settings(current));

    expect(projection).toEqual({
      policy_version: "0.1.0",
      day_boundary: "LEARNING_TIMEZONE",
      learning_timezone: "Asia/Shanghai",
      timezone_epoch_id: "timezone-epoch-shanghai",
      effective_days: [
        { learning_day_id: "timezone-epoch-shanghai:2026-08-25", timezone_epoch_id: "timezone-epoch-shanghai", local_calendar_date: "2026-08-25" },
        { learning_day_id: "timezone-epoch-shanghai:2026-08-26", timezone_epoch_id: "timezone-epoch-shanghai", local_calendar_date: "2026-08-26" },
      ],
      current_streak: 2,
      best_streak: 2,
      total_effective_days: 2,
    });
  });

  it("ends only the current streak after a gap while preserving best and total history", () => {
    const current = epoch("timezone-epoch-los-angeles", "America/Los_Angeles", "2026-08-19T00:00:00.000Z");
    const projection = projectEffectiveStreak([
      learningDay("session-one", current, "2026-08-20"),
      learningDay("session-two", current, "2026-08-21"),
      learningDay("session-three", current, "2026-08-23"),
    ], "2026-08-27T12:00:00.000Z", settings(current));

    expect(projection.current_streak).toBe(0);
    expect(projection.best_streak).toBe(2);
    expect(projection.total_effective_days).toBe(3);
  });

  it("starts a new current streak epoch without deleting historical best or total days", () => {
    const first = epoch("timezone-epoch-shanghai", "Asia/Shanghai", "2026-08-20T00:00:00.000Z");
    const second = epoch("timezone-epoch-los-angeles", "America/Los_Angeles", "2026-08-27T00:00:00.000Z");
    const projection = projectEffectiveStreak([
      learningDay("session-old-one", first, "2026-08-25"),
      learningDay("session-old-two", first, "2026-08-26"),
      learningDay("session-new", second, "2026-08-26"),
    ], "2026-08-27T12:00:00.000Z", settings(first, second));

    expect(projection.current_streak).toBe(1);
    expect(projection.best_streak).toBe(2);
    expect(projection.total_effective_days).toBe(3);
    expect(projection.effective_days.map((day) => day.learning_day_id)).toEqual([
      "timezone-epoch-shanghai:2026-08-25",
      "timezone-epoch-shanghai:2026-08-26",
      "timezone-epoch-los-angeles:2026-08-26",
    ]);
  });
});
