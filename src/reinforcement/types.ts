export type Document = Record<string, any>;

export type ReinforcementOutcome = "successful" | "partial" | "unsuccessful";

export interface ReinforcementObservation {
  evidenceRef: string;
  sessionId: string;
  occurredAt: string;
  outcome: ReinforcementOutcome;
  skillId: string;
  errorPatternId?: string;
  evidenceClass: "training_performance" | "transfer_performance" | "assessment_performance";
  pedagogicalIntent: string;
  materialHash?: string;
  resourceHashes: string[];
}

export interface TargetedIntervention {
  evidenceRef: string;
  occurredAt: string;
  skillId: string;
  errorPatternId: string;
}

export interface AuthoritativeSessionEvidence {
  sessionId: string;
  runId: string;
  segmentId: string;
  packageId: string;
  state: "COMPLETED";
  completedAt: string;
  objective: string;
  targetSkills: string[];
  hypothesisRefs: string[];
  evidenceClass: "training_performance" | "transfer_performance" | "assessment_performance";
  hasLegitimateParticipation: boolean;
  clockAnomaly: boolean;
  completionEvidenceRef: string;
  observations: ReinforcementObservation[];
  interventions: TargetedIntervention[];
  interventionEvidenceRefs: string[];
  attemptedTransferEvidenceRefs: string[];
}

export type ReinforcementEventType =
  | "SESSION_COMPLETE"
  | "MISSION_ADVANCED"
  | "TRANSFER_CONFIRMED"
  | "RETENTION_CONFIRMED"
  | "PATTERN_BROKEN"
  | "STREAK_EXTENDED"
  | "PERSONAL_BEST";

export interface EligibleReinforcementEvent {
  semantic_id: string;
  event_type: ReinforcementEventType;
  policy_version: "0.1.0";
  evidence_refs: string[];
}

export interface RejectedReinforcementEvent {
  event_type: ReinforcementEventType;
  reason: string;
}

export interface ReinforcementEvidenceSource {
  inspectionStatus: string;
  session: Document;
  packageDocument: Document;
  result?: Document;
  events: Document[];
}
