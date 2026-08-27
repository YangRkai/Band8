import type {
  AuthoritativeSessionEvidence,
  ReinforcementEvidenceSource,
  ReinforcementObservation,
} from "./types.js";

export function collectAuthoritativeEvidence(
  sources: readonly ReinforcementEvidenceSource[],
): AuthoritativeSessionEvidence[] {
  const seenSessions = new Set<string>();
  const collected: AuthoritativeSessionEvidence[] = [];
  for (const source of sources) {
    const sessionId = source.session.session_id as string;
    if (
      source.inspectionStatus !== "AUTHORITATIVE"
      || source.session.state !== "COMPLETED"
      || source.result === undefined
      || seenSessions.has(sessionId)
    ) continue;
    seenSessions.add(sessionId);

    const eventsById = new Map<string, Record<string, any>>(
      source.events.map((event) => [event.event_id as string, event]),
    );
    const activities = new Map<string, Record<string, any>>(
      (source.packageDocument.activities as Array<Record<string, any>>)
        .map((activity) => [activity.activity_id as string, activity]),
    );
    const resources = new Map<string, Record<string, any>>(
      (source.packageDocument.resources as Array<Record<string, any>>)
        .map((resource) => [resource.resource_id as string, resource]),
    );
    const hypotheses = (source.packageDocument.training_hypotheses as Array<Record<string, any>>)
      .map((item) => item.hypothesis_id as string);
    const targetSkills = source.packageDocument.target_skills as string[];
    const safelyBoundSkill = targetSkills.length === 1
      && hypotheses.length === 1
      && [...activities.values()].every((activity) => (
        Array.isArray(activity.skill_refs)
        && activity.skill_refs.length === 1
        && activity.skill_refs[0] === targetSkills[0]
      ))
      ? targetSkills[0]
      : undefined;
    const errorPatternId = safelyBoundSkill === undefined ? undefined : hypotheses[0];
    const completed = [...source.events].reverse().find((event) => event.event_type === "session_completed");
    if (completed === undefined) continue;

    const observations: ReinforcementObservation[] = [];
    for (const result of source.result.objective_results as Array<Record<string, any>>) {
      const activity = activities.get(result.activity_id as string);
      if (activity === undefined) continue;
      const submissions = (result.evidence_refs as string[])
        .map((reference) => eventsById.get(reference))
        .filter((event): event is Record<string, any> => (
          event?.event_type === "answer_submitted" && event.activity_id === result.activity_id
        ));
      if (submissions.length !== 1) continue;
      const event = submissions[0]!;
      const reference = event.event_id as string;
      const hashes = (activity.resource_refs as string[])
        .map((resourceId) => resources.get(resourceId)?.provenance?.content_hash as string | undefined)
        .filter((value): value is string => value !== undefined)
        .sort();
      const materialResources = (activity.resource_refs as string[])
        .map((resourceId) => resources.get(resourceId))
        .filter((resource): resource is Record<string, any> => resource !== undefined && resource.resource_type !== "feedback");
      const materialHash = materialResources.length === 1
        ? materialResources[0]!.provenance.content_hash as string
        : undefined;
      for (const skillId of activity.skill_refs as string[]) {
        observations.push({
          evidenceRef: reference,
          sessionId,
          occurredAt: event.timestamp as string,
          outcome: result.outcome,
          skillId,
          ...(errorPatternId === undefined ? {} : { errorPatternId }),
          evidenceClass: result.performance_class,
          pedagogicalIntent: activity.pedagogical_intent,
          ...(materialHash === undefined ? {} : { materialHash }),
          resourceHashes: hashes,
        });
      }
    }

    const interventionEvents = source.events
      .filter((event) => event.event_type === "correction_submitted")
      .sort((left, right) => (left.event_id as string).localeCompare(right.event_id as string));
    const interventions = interventionEvents.flatMap((event) => {
      const activity = activities.get(event.activity_id as string);
      const skillId = activity?.skill_refs?.[0] as string | undefined;
      if (skillId === undefined || skillId !== safelyBoundSkill || errorPatternId === undefined) return [];
      return [{
        evidenceRef: event.event_id as string,
        occurredAt: event.timestamp as string,
        skillId,
        errorPatternId,
      }];
    });
    const interventionEvidenceRefs = interventions.map((item) => item.evidenceRef);
    for (const observation of observations) {
      if (
        observation.outcome === "successful"
        && observation.pedagogicalIntent === "correction"
        && observation.errorPatternId !== undefined
        && !interventionEvidenceRefs.includes(observation.evidenceRef)
      ) {
        interventions.push({
          evidenceRef: observation.evidenceRef,
          occurredAt: observation.occurredAt,
          skillId: observation.skillId,
          errorPatternId: observation.errorPatternId,
        });
        interventionEvidenceRefs.push(observation.evidenceRef);
      }
    }
    const transferActivityIds = new Set<string>(
      [...activities.values()]
        .filter((activity) => activity.pedagogical_intent === "transfer")
        .map((activity) => activity.activity_id as string),
    );
    const attemptedTransferEvidenceRefs = source.events
      .filter((event) => event.event_type === "answer_submitted" && transferActivityIds.has(event.activity_id as string))
      .map((event) => event.event_id as string)
      .sort();
    collected.push({
      sessionId,
      runId: source.session.run_id,
      segmentId: source.session.segment_id,
      packageId: source.session.package_id,
      state: "COMPLETED",
      completedAt: source.result.completed_at,
      objective: source.packageDocument.session_intent.objective,
      targetSkills: [...targetSkills].sort(),
      hypothesisRefs: hypotheses.sort(),
      evidenceClass: source.packageDocument.session_intent.evidence_class,
      hasLegitimateParticipation: source.events.some((event) => event.event_type === "answer_submitted"),
      clockAnomaly: source.events.some((event) => event.event_type === "clock_anomaly_detected"),
      completionEvidenceRef: completed.event_id,
      observations: observations.sort((left, right) => left.evidenceRef.localeCompare(right.evidenceRef)),
      interventions,
      interventionEvidenceRefs,
      attemptedTransferEvidenceRefs,
    });
  }
  return collected.sort((left, right) => left.completedAt.localeCompare(right.completedAt) || left.sessionId.localeCompare(right.sessionId));
}
