import type { ReinforcementEvaluation } from "./policy.js";
import type { Document, EligibleReinforcementEvent, ReinforcementEventType } from "./types.js";

const priority: Record<ReinforcementEventType, number> = {
  PATTERN_BROKEN: 700,
  PERSONAL_BEST: 650,
  RETENTION_CONFIRMED: 600,
  TRANSFER_CONFIRMED: 500,
  MISSION_ADVANCED: 400,
  STREAK_EXTENDED: 300,
  SESSION_COMPLETE: 200,
};

export interface RevealProjection {
  policy_version: "0.1.0";
  session_id: string;
  primary_event: EligibleReinforcementEvent | null;
  supporting_events: EligibleReinforcementEvent[];
  evidence_refs: string[];
  qualification_change: Document | null;
}

export function projectReveal(evaluation: ReinforcementEvaluation): RevealProjection {
  const ordered = [...evaluation.eligible].sort((left, right) => (
    priority[right.event_type] - priority[left.event_type]
    || left.semantic_id.localeCompare(right.semantic_id)
  ));
  const qualification = evaluation.currentQualification;
  return {
    policy_version: "0.1.0",
    session_id: evaluation.target_session_id,
    primary_event: ordered[0] ?? null,
    supporting_events: ordered.slice(1),
    evidence_refs: [...new Set(ordered.flatMap((item) => item.evidence_refs))].sort(),
    qualification_change: qualification === undefined ? null : {
      qualification: qualification.qualification,
      current_decision_id: qualification.current_decision_id,
    },
  };
}
