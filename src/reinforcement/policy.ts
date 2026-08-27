import { reinforcementIdentity } from "./identity.js";
import { projectEffectiveStreak } from "./streak.js";
import { compareTimestamps, epochMilliseconds } from "./time.js";
import type { LearningDayRecord, LearningTimezoneSettings } from "../storage/learning-timezone-store.js";
import type {
  AuthoritativeSessionEvidence,
  Document,
  EligibleReinforcementEvent,
  ReinforcementEventType,
  ReinforcementObservation,
  RejectedReinforcementEvent,
  TargetedIntervention,
} from "./types.js";

export interface PolicyInput {
  learnerId: string;
  targetSessionId: string;
  sessions: AuthoritativeSessionEvidence[];
  learningDays: LearningDayRecord[];
  learningTimezone: LearningTimezoneSettings;
  evaluatedAt: string;
  existingHistoricalAward?: Document;
  existingCurrentQualification?: Document;
}

export interface ReinforcementEvaluation {
  policy_version: "0.1.0";
  target_session_id: string;
  evaluated_at: string;
  eligible: EligibleReinforcementEvent[];
  rejected: RejectedReinforcementEvent[];
  historicalDecision?: Document;
  qualificationUpdate?: Document;
  currentQualification?: Document;
  claims_mastery: false;
}

const policyVersion = "0.1.0" as const;

function event(eventType: ReinforcementEventType, evidenceRefs: string[]): EligibleReinforcementEvent {
  const refs = [...new Set(evidenceRefs)].sort();
  return {
    semantic_id: reinforcementIdentity(policyVersion, eventType, refs),
    event_type: eventType,
    policy_version: policyVersion,
    evidence_refs: refs,
  };
}

function observationDocument(observation: ReinforcementObservation): Document {
  return {
    evidence_ref: observation.evidenceRef,
    session_id: observation.sessionId,
    occurred_at: observation.occurredAt,
    outcome: observation.outcome,
  };
}

interface PatternChain {
  skillId: string;
  errorPatternId: string;
  weaknesses: ReinforcementObservation[];
  intervention: TargetedIntervention;
  improvements: ReinforcementObservation[];
  delayed: ReinforcementObservation;
  delaySeconds: number;
  transfer: ReinforcementObservation;
  sourceHash: string;
  transferHash: string;
  triggerSessionId: string;
}

function findPatternChain(sessions: AuthoritativeSessionEvidence[], target: AuthoritativeSessionEvidence): PatternChain | undefined {
  const usableSessions = sessions.filter((session) => !session.clockAnomaly);
  const interventions = usableSessions.flatMap((session) => session.interventions)
    .filter((item) => target.targetSkills.includes(item.skillId) && target.hypothesisRefs.includes(item.errorPatternId))
    .sort((left, right) => compareTimestamps(left.occurredAt, right.occurredAt) || left.evidenceRef.localeCompare(right.evidenceRef));
  const observations = usableSessions.flatMap((session) => session.observations)
    .sort((left, right) => compareTimestamps(left.occurredAt, right.occurredAt) || left.evidenceRef.localeCompare(right.evidenceRef));
  for (const intervention of interventions) {
    const matching = observations.filter((observation) => (
      observation.skillId === intervention.skillId && observation.errorPatternId === intervention.errorPatternId
    ));
    const weaknessCandidates = matching.filter((observation) => (
      observation.outcome === "unsuccessful" && compareTimestamps(observation.occurredAt, intervention.occurredAt) < 0
    ));
    const weaknesses: ReinforcementObservation[] = [];
    const weaknessSessions = new Set<string>();
    for (const candidate of weaknessCandidates) {
      if (weaknessSessions.has(candidate.sessionId)) continue;
      weaknessSessions.add(candidate.sessionId);
      weaknesses.push(candidate);
      if (weaknesses.length === 2) break;
    }
    if (weaknesses.length < 2) continue;
    const successes = matching.filter((observation) => (
      observation.outcome === "successful" && compareTimestamps(observation.occurredAt, intervention.occurredAt) > 0
    ));
    const improvements: ReinforcementObservation[] = [];
    const improvementSessions = new Set<string>();
    for (const success of successes) {
      if (improvementSessions.has(success.sessionId)) continue;
      improvementSessions.add(success.sessionId);
      improvements.push(success);
      if (improvements.length === 2) break;
    }
    if (improvements.length < 2) continue;
    const improvementRefs = new Set(improvements.map((observation) => observation.evidenceRef));
    const lastImprovementAt = improvements.map((item) => epochMilliseconds(item.occurredAt)).sort((a, b) => b - a)[0]!;
    const delayed = successes.find((observation) => (
      observation.pedagogicalIntent === "retrieval"
      && !improvementRefs.has(observation.evidenceRef)
      && epochMilliseconds(observation.occurredAt) > lastImprovementAt
      && epochMilliseconds(observation.occurredAt) - epochMilliseconds(intervention.occurredAt) >= 86_400_000
    ));
    if (delayed === undefined) continue;
    const sourceHash = delayed.materialHash;
    if (sourceHash === undefined) continue;
    const transfer = successes.find((observation) => (
      (observation.evidenceClass === "transfer_performance" || observation.pedagogicalIntent === "transfer")
      && compareTimestamps(observation.occurredAt, delayed.occurredAt) > 0
      && observation.materialHash !== undefined
      && observation.materialHash !== sourceHash
      && !matching.some((candidate) => (
        compareTimestamps(candidate.occurredAt, observation.occurredAt) < 0
        && candidate.materialHash === observation.materialHash
      ))
    ));
    const transferHash = transfer?.materialHash;
    if (transfer === undefined || transferHash === undefined) continue;
    const evaluationAt = transfer.occurredAt;
    const contradiction = matching.find((observation) => (
      observation.evidenceClass === "assessment_performance"
      && observation.outcome !== "successful"
      && compareTimestamps(observation.occurredAt, evaluationAt) <= 0
    ));
    if (contradiction !== undefined) continue;
    return {
      skillId: intervention.skillId,
      errorPatternId: intervention.errorPatternId,
      weaknesses,
      intervention,
      improvements,
      delayed,
      delaySeconds: Math.floor((epochMilliseconds(delayed.occurredAt) - epochMilliseconds(intervention.occurredAt)) / 1000),
      transfer,
      sourceHash,
      transferHash,
      triggerSessionId: transfer.sessionId,
    };
  }
  return undefined;
}

function createHistoricalDecision(learnerId: string, chain: PatternChain): Document {
  const evidenceRefs = [
    ...chain.weaknesses.map((item) => item.evidenceRef),
    chain.intervention.evidenceRef,
    ...chain.improvements.map((item) => item.evidenceRef),
    chain.delayed.evidenceRef,
    chain.transfer.evidenceRef,
  ];
  return {
    schema_version: "0.1.0",
    protocol_version: "0.1.0",
    policy_version: policyVersion,
    decision_id: reinforcementIdentity(policyVersion, "PATTERN_BROKEN_DECISION", evidenceRefs),
    learner_id: learnerId,
    skill_id: chain.skillId,
    error_pattern_id: chain.errorPatternId,
    decision_type: "historical_award",
    reward_type: "pattern_broken",
    qualification: "confirmed",
    evaluated_at: chain.transfer.occurredAt,
    evidence_chain: {
      recurring_weakness: chain.weaknesses.map(observationDocument),
      targeted_intervention: { evidence_ref: chain.intervention.evidenceRef, occurred_at: chain.intervention.occurredAt },
      repeated_improvement: chain.improvements.map(observationDocument),
      delayed_retrieval: {
        evidence_ref: chain.delayed.evidenceRef,
        occurred_at: chain.delayed.occurredAt,
        delay_seconds: chain.delaySeconds,
        outcome: chain.delayed.outcome,
      },
      transfer: {
        evidence_ref: chain.transfer.evidenceRef,
        source_resource_hash: chain.sourceHash,
        transfer_resource_hash: chain.transferHash,
        outcome: chain.transfer.outcome,
      },
      unresolved_contradictory_assessment_refs: [],
      regression_evidence_refs: [],
    },
    supersedes: null,
  };
}

function qualificationProjection(award: Document, update?: Document): Document {
  const current = update ?? award;
  return {
    policy_version: current.policy_version,
    learner_id: current.learner_id,
    skill_id: current.skill_id,
    error_pattern_id: current.error_pattern_id,
    qualification: current.qualification,
    current_decision_id: current.decision_id,
    historical_award_id: award.decision_id,
    evidence_refs: update?.evidence_chain.regression_evidence_refs ?? [award.decision_id],
    evaluated_at: current.evaluated_at,
  };
}

function compareSession(left: AuthoritativeSessionEvidence, right: AuthoritativeSessionEvidence): number {
  return compareTimestamps(left.completedAt, right.completedAt) || left.sessionId.localeCompare(right.sessionId);
}

export function evaluatePolicy(input: PolicyInput): ReinforcementEvaluation {
  const target = input.sessions.find((session) => session.sessionId === input.targetSessionId);
  if (target === undefined) throw new Error(`target session is not authoritative: ${input.targetSessionId}`);
  const allSessions = input.sessions.filter((session) => compareTimestamps(session.completedAt, input.evaluatedAt) <= 0);
  const sessions = allSessions.filter((session) => compareSession(session, target) <= 0);
  const prior = sessions.filter((session) => compareSession(session, target) < 0);
  const eligible: EligibleReinforcementEvent[] = [];
  const rejected: RejectedReinforcementEvent[] = [];
  const usable = target.hasLegitimateParticipation && !target.clockAnomaly;

  if (target.hasLegitimateParticipation) eligible.push(event("SESSION_COMPLETE", [target.completionEvidenceRef]));
  else rejected.push({ event_type: "SESSION_COMPLETE", reason: "no_legitimate_learner_participation" });

  if (usable && (target.interventions.length > 0 || target.observations.some((item) => item.outcome === "successful"))) {
    eligible.push(event("MISSION_ADVANCED", [
      ...target.interventions.map((item) => item.evidenceRef),
      ...target.observations.filter((item) => item.outcome === "successful").map((item) => item.evidenceRef),
    ]));
  } else rejected.push({ event_type: "MISSION_ADVANCED", reason: usable ? "mission_evidence_not_advanced" : "evidence_not_usable" });

  const transferEvidence: string[] = [];
  if (usable) {
    for (const observation of target.observations.filter((item) => item.outcome === "successful" && (item.evidenceClass === "transfer_performance" || item.pedagogicalIntent === "transfer"))) {
      const earlierObservations = sessions.filter((session) => !session.clockAnomaly).flatMap((session) => session.observations).filter((candidate) => (
        compareTimestamps(candidate.occurredAt, observation.occurredAt) < 0
      ));
      const priorObservation = earlierObservations.find((candidate) => (
        candidate.skillId === observation.skillId
        && candidate.materialHash !== undefined
        && observation.materialHash !== undefined
        && candidate.materialHash !== observation.materialHash
      ));
      const materialPreviouslySeen = observation.materialHash !== undefined && earlierObservations.some((candidate) => (
        candidate.skillId === observation.skillId && candidate.materialHash === observation.materialHash
      ));
      if (priorObservation !== undefined && !materialPreviouslySeen) transferEvidence.push(priorObservation.evidenceRef, observation.evidenceRef);
    }
  }
  if (transferEvidence.length > 0) eligible.push(event("TRANSFER_CONFIRMED", transferEvidence));
  else rejected.push({ event_type: "TRANSFER_CONFIRMED", reason: "changed_material_not_proven" });

  const retentionEvidence: string[] = [];
  if (target.clockAnomaly) rejected.push({ event_type: "RETENTION_CONFIRMED", reason: "clock_anomaly" });
  else {
    for (const observation of target.observations.filter((item) => item.outcome === "successful" && item.pedagogicalIntent === "retrieval")) {
      const earlier = prior.filter((session) => !session.clockAnomaly).flatMap((session) => session.observations).find((candidate) => (
        candidate.skillId === observation.skillId
        && candidate.outcome === "successful"
        && epochMilliseconds(observation.occurredAt) - epochMilliseconds(candidate.occurredAt) >= 86_400_000
      ));
      if (earlier !== undefined) retentionEvidence.push(earlier.evidenceRef, observation.evidenceRef);
    }
    if (retentionEvidence.length === 0) rejected.push({ event_type: "RETENTION_CONFIRMED", reason: "delayed_retrieval_not_proven" });
  }
  if (retentionEvidence.length > 0) eligible.push(event("RETENTION_CONFIRMED", retentionEvidence));

  const includedSessions = new Set(sessions.map((session) => session.sessionId));
  const learningDays = input.learningDays.filter((record) => includedSessions.has(record.session_id));
  const streak = projectEffectiveStreak(learningDays, input.evaluatedAt, input.learningTimezone);
  const targetDay = learningDays.find((record) => record.session_id === target.sessionId);
  const priorSessions = new Set(prior.map((session) => session.sessionId));
  const priorSameDay = targetDay !== undefined && learningDays.some((record) => (
    priorSessions.has(record.session_id) && record.learning_day_id === targetDay.learning_day_id
  ));
  if (usable && targetDay !== undefined && streak.effective_days.some((day) => day.learning_day_id === targetDay.learning_day_id) && !priorSameDay) {
    eligible.push(event("STREAK_EXTENDED", [target.completionEvidenceRef]));
  }
  else rejected.push({ event_type: "STREAK_EXTENDED", reason: priorSameDay ? "effective_day_already_counted" : "effective_day_not_qualified" });

  rejected.push({ event_type: "PERSONAL_BEST", reason: "no_comparable_objective_metric" });

  const chain = findPatternChain(sessions, target);
  let award = input.existingHistoricalAward;
  if (
    award !== undefined
    && (!target.targetSkills.includes(award.skill_id as string) || !target.hypothesisRefs.includes(award.error_pattern_id as string))
  ) award = undefined;
  if (award === undefined && chain !== undefined) award = createHistoricalDecision(input.learnerId, chain);
  if (chain !== undefined && award !== undefined && target.sessionId === chain.triggerSessionId) {
    eligible.push(event("PATTERN_BROKEN", [
      ...award.evidence_chain.recurring_weakness.map((item: Document) => item.evidence_ref),
      award.evidence_chain.targeted_intervention.evidence_ref,
      ...award.evidence_chain.repeated_improvement.map((item: Document) => item.evidence_ref),
      award.evidence_chain.delayed_retrieval.evidence_ref,
      award.evidence_chain.transfer.evidence_ref,
    ]));
  } else if (award === undefined) rejected.push({ event_type: "PATTERN_BROKEN", reason: "complete_pattern_chain_not_proven" });
  else rejected.push({ event_type: "PATTERN_BROKEN", reason: "historical_award_already_exists" });

  let qualificationUpdate: Document | undefined;
  if (award !== undefined) {
    const regressions = allSessions.filter((session) => !session.clockAnomaly).flatMap((session) => session.observations).filter((observation) => (
      observation.skillId === award.skill_id
      && observation.errorPatternId === award.error_pattern_id
      && observation.evidenceClass === "assessment_performance"
      && observation.outcome !== "successful"
      && compareTimestamps(observation.occurredAt, award.evaluated_at) > 0
    ));
    if (regressions.length > 0) {
      const refs = regressions.map((item) => item.evidenceRef).sort();
      const evaluatedAt = regressions.map((item) => item.occurredAt).sort(compareTimestamps).at(-1);
      const currentRefs = input.existingCurrentQualification?.evidence_refs as string[] | undefined;
      const alreadyCurrent = input.existingCurrentQualification?.qualification === "revoked"
        && input.existingCurrentQualification.evaluated_at === evaluatedAt
        && currentRefs !== undefined
        && currentRefs.length === refs.length
        && currentRefs.every((reference, index) => reference === refs[index]);
      if (!alreadyCurrent) {
        const supersededDecisionId = award.decision_id as string;
        qualificationUpdate = {
          ...award,
          decision_id: reinforcementIdentity(policyVersion, "PATTERN_BROKEN_QUALIFICATION_REVOKED", [supersededDecisionId, ...refs]),
          decision_type: "qualification_update",
          qualification: "revoked",
          evaluated_at: evaluatedAt,
          evidence_chain: { ...award.evidence_chain, regression_evidence_refs: refs },
          supersedes: supersededDecisionId,
        };
      }
    }
  }

  const currentQualification = award === undefined
    ? undefined
    : qualificationUpdate === undefined && input.existingCurrentQualification !== undefined
      ? input.existingCurrentQualification
      : qualificationProjection(award, qualificationUpdate);

  return {
    policy_version: policyVersion,
    target_session_id: input.targetSessionId,
    evaluated_at: input.evaluatedAt,
    eligible,
    rejected,
    ...(award === undefined ? {} : { historicalDecision: award }),
    ...(qualificationUpdate === undefined ? {} : { qualificationUpdate }),
    ...(currentQualification === undefined ? {} : { currentQualification }),
    claims_mastery: false,
  };
}
