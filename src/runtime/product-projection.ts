import type {
  CoachDto,
  CoachStatus,
  HistoryPageDto,
  IeltsGoalDto,
  MissionDto,
  ProgressDto,
  RevealDto,
  SettingsDto,
  TodayDto,
  TrainingDto,
} from "../product-api/dto.js";
import type { MissionProjection } from "../reinforcement/mission.js";
import type { RevealProjection } from "../reinforcement/reveal.js";

type JsonObject = { [key: string]: unknown };

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export type IeltsGoalProjection = IeltsGoalDto;

export const BAND8_IELTS_GOAL = {
  overall_target: 8,
  section_minimums: {
    listening: 7.5,
    reading: 7.5,
    writing: 7.5,
    speaking: 7.5,
  },
} as const satisfies IeltsGoalDto;

export function projectIeltsGoal(value: unknown): IeltsGoalDto {
  const goal = object(value) ?? BAND8_IELTS_GOAL;
  const sections = object(goal.section_minimums) ?? {};
  const overall = finite(goal.overall_target);
  if (overall === undefined) throw new Error("learner goal overall_target must be numeric");
  const listening = finite(sections.listening);
  const reading = finite(sections.reading);
  const writing = finite(sections.writing);
  const speaking = finite(sections.speaking);
  return {
    overall_target: overall,
    section_minimums: {
      ...(listening === undefined ? {} : { listening }),
      ...(reading === undefined ? {} : { reading }),
      ...(writing === undefined ? {} : { writing }),
      ...(speaking === undefined ? {} : { speaking }),
    },
  };
}

export function projectProductMission(value: MissionProjection): MissionDto {
  const goal = projectIeltsGoal(value.goal);
  return {
    mission_id: value.mission_id,
    policy_version: value.policy_version,
    run_id: value.run_id,
    objective: value.objective,
    target_skills: [...value.target_skills],
    hypothesis_refs: [...value.hypothesis_refs],
    status: value.status,
    evidence_refs: [...value.evidence_refs],
    goal: {
      ...goal,
      unresolved_blockers: [...value.goal.unresolved_blockers],
      validated_qualifications: value.goal.validated_qualifications.map((qualification) => ({
        skill_id: qualification.skill_id,
        error_pattern_id: qualification.error_pattern_id,
        qualification: qualification.qualification,
      })),
      assessment_evidence_refs: [...value.goal.assessment_evidence_refs],
    },
  };
}

export function projectProductReveal(value: RevealProjection): RevealDto {
  const event = value.primary_event?.event_type ?? "SESSION_COMPLETE";
  const qualification = value.qualification_change?.qualification;
  const historicalPattern = event === "PATTERN_BROKEN" && qualification === "revoked";
  const confirmedPattern = event === "PATTERN_BROKEN" && !historicalPattern;
  return {
    policy_version: value.policy_version,
    session_id: value.session_id,
    primary_event: value.primary_event,
    supporting_events: value.supporting_events,
    evidence_refs: value.evidence_refs,
    qualification_change: qualification === undefined ? null : { qualification: String(qualification) },
    presentation: historicalPattern
      ? {
          title: "PATTERN BROKEN — HISTORICAL",
          message: "The historical award remains recorded.",
          validation_label: "NEEDS REVALIDATION",
          qualification_label: "CURRENT QUALIFICATION REVOKED",
        }
      : confirmedPattern
        ? {
            title: "PATTERN BROKEN",
            message: "Confirmed through repeated correction, delayed retrieval, and changed-material transfer.",
            validation_label: "QUALIFICATION CONFIRMED",
            qualification_label: qualification === undefined ? null : `CURRENT QUALIFICATION ${String(qualification).toUpperCase()}`,
          }
        : {
            title: event.replaceAll("_", " "),
            message: "You improved this in the session. Stable transfer has not been independently proven.",
            validation_label: "VALIDATION PENDING",
            qualification_label: qualification === undefined ? null : `CURRENT QUALIFICATION ${String(qualification).toUpperCase()}`,
          },
  };
}

export type CoachProductStatus = CoachStatus;
export type TodayProjection = TodayDto;
export type TrainingProjection = TrainingDto;
export type CoachProjection = CoachDto;
export type ProgressProjection = ProgressDto;
export type HistoryProjection = HistoryPageDto;
export type WorkspaceInformationProjection = SettingsDto;

export interface HistoryOptions {
  limit?: number;
  cursor?: number;
}
