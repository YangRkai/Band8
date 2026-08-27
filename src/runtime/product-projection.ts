import type { EffectiveStreakProjection } from "../reinforcement/streak.js";
import type { MissionProjection } from "../reinforcement/mission.js";
import type { RevealProjection } from "../reinforcement/reveal.js";
import type { LearnerActivityView } from "./projection.js";

type Document = Record<string, any>;

export interface IeltsGoalProjection {
  overall_target: number;
  section_minimums: { listening: number; reading: number; writing: number; speaking: number };
}

export const BAND8_IELTS_GOAL = {
  overall_target: 8,
  section_minimums: {
    listening: 7.5,
    reading: 7.5,
    writing: 7.5,
    speaking: 7.5,
  },
} as const;

export function projectIeltsGoal(value: Document | undefined): IeltsGoalProjection {
  const goal = value ?? BAND8_IELTS_GOAL;
  const sections = goal.section_minimums as Document;
  return {
    overall_target: Number(goal.overall_target),
    section_minimums: {
      listening: Number(sections.listening),
      reading: Number(sections.reading),
      writing: Number(sections.writing),
      speaking: Number(sections.speaking),
    },
  };
}

export type CoachProductStatus = "NO_PACKAGE" | "TRAINING_READY" | "REVIEW_REQUIRED" | "CONTINUATION_READY";

export interface TodayProjection {
  empty: boolean;
  goal: IeltsGoalProjection;
  mission: MissionProjection | null;
  effective_streak: EffectiveStreakProjection | null;
  last_reveal: RevealProjection | null;
  coach_status: CoachProductStatus;
  primary_action: "GO_TO_COACH" | "CONTINUE_TRAINING";
}

export interface TrainingProjection {
  session_id: string | null;
  package_id: string;
  state: string;
  activity_number: number;
  activity_count: number;
  mission: MissionProjection | null;
  current_activity: LearnerActivityView | null;
  integrity: { status: string };
}

export interface CoachProjection {
  status: CoachProductStatus;
  session_id?: string;
  checkpoint_id?: string;
  evidence_count?: number;
  evidence_refs?: string[];
  bundle_identity?: string;
}

export interface ProgressProjection {
  goal: IeltsGoalProjection;
  missions: MissionProjection[];
  validated_qualifications: Array<{
    skill_id: string;
    error_pattern_id: string;
    qualification: string;
    evaluated_at: string;
  }>;
  retention: "CONFIRMED" | "EVIDENCE_PENDING";
  transfer: "CONFIRMED" | "EVIDENCE_PENDING";
  pattern_status: "PATTERN_BROKEN" | "NEEDS_REVALIDATION" | "EVIDENCE_PENDING";
}

export interface HistoryProjection {
  items: Array<{
    session_id: string;
    state: string;
    objective: string;
    target_skills: string[];
    started_at: string | null;
    completed_at: string | null;
    submissions: Document[];
    artifacts: Document[];
    corrections: Document[];
    reveal: RevealProjection | null;
    integrity: { status: string };
  }>;
  next_cursor: number | null;
}

export interface WorkspaceInformationProjection {
  data_location: string;
  learning_timezone: null | {
    learning_timezone: string;
    timezone_epoch_id: string;
    effective_from: string;
    created_at: string;
  };
  local_only: true;
}

export interface HistoryOptions {
  limit?: number;
  cursor?: number;
}
