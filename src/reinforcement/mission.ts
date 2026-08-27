import { canonicalHash } from "../protocol/canonical.js";
import type { AuthoritativeSessionEvidence, Document } from "./types.js";

export type MissionStatus = "OPEN" | "IN_PROGRESS" | "EVIDENCE_PENDING" | "VALIDATION_PENDING" | "CLOSED";

export interface MissionProjection {
  mission_id: string;
  policy_version: "0.1.0";
  run_id: string;
  objective: string;
  target_skills: string[];
  hypothesis_refs: string[];
  status: MissionStatus;
  evidence_refs: string[];
  goal: GoalProjection;
}

export interface GoalProjection {
  overall_target: number;
  section_minimums: Record<string, number>;
  unresolved_blockers: string[];
  validated_qualifications: Array<{
    skill_id: string;
    error_pattern_id: string;
    qualification: string;
  }>;
  assessment_evidence_refs: string[];
}

export function projectMission(
  packageDocument: Document,
  session: { state: string },
  evidence?: AuthoritativeSessionEvidence,
  currentQualification?: Document,
): MissionProjection {
  const targetSkills = [...packageDocument.target_skills].sort() as string[];
  const hypothesisRefs = (packageDocument.training_hypotheses as Document[])
    .map((item) => item.hypothesis_id as string)
    .sort();
  const relevantQualification = currentQualification !== undefined
    && targetSkills.includes(currentQualification.skill_id as string)
    && hypothesisRefs.includes(currentQualification.error_pattern_id as string)
    ? currentQualification
    : undefined;
  let status: MissionStatus;
  if (["CREATED", "READY"].includes(session.state)) status = "OPEN";
  else if (session.state === "RUNNING" || session.state === "SUSPENDED") status = "IN_PROGRESS";
  else if (
    relevantQualification?.qualification === "confirmed"
  ) status = "CLOSED";
  else if (
    evidence?.evidenceClass === "assessment_performance"
    && evidence.observations.some((observation) => observation.outcome === "successful")
  ) status = "CLOSED";
  else if (evidence?.observations.some((observation) => observation.outcome === "successful")) status = "VALIDATION_PENDING";
  else status = "EVIDENCE_PENDING";
  const identity = canonicalHash({
    policy_version: "0.1.0",
    run_id: packageDocument.run_id,
    target_skills: targetSkills,
    hypothesis_refs: hypothesisRefs,
  }).slice("sha256:".length, "sha256:".length + 24);
  const learnerGoal = packageDocument.learner_goal as Document;
  const sectionMinimums = Object.fromEntries(
    Object.entries(learnerGoal.section_minimums as Document)
      .sort(([left], [right]) => left.localeCompare(right)),
  ) as Record<string, number>;
  const confirmedPattern = relevantQualification?.qualification === "confirmed"
    ? relevantQualification.error_pattern_id as string
    : undefined;
  return {
    mission_id: `mission-${identity}`,
    policy_version: "0.1.0",
    run_id: packageDocument.run_id,
    objective: packageDocument.session_intent.objective,
    target_skills: targetSkills,
    hypothesis_refs: hypothesisRefs,
    status,
    evidence_refs: evidence === undefined ? [] : [
      evidence.completionEvidenceRef,
      ...evidence.observations.map((observation) => observation.evidenceRef),
      ...evidence.interventionEvidenceRefs,
    ].filter((value, index, values) => values.indexOf(value) === index).sort(),
    goal: {
      overall_target: learnerGoal.overall_target as number,
      section_minimums: sectionMinimums,
      unresolved_blockers: hypothesisRefs.filter((hypothesis) => hypothesis !== confirmedPattern),
      validated_qualifications: relevantQualification === undefined ? [] : [{
        skill_id: relevantQualification.skill_id as string,
        error_pattern_id: relevantQualification.error_pattern_id as string,
        qualification: relevantQualification.qualification as string,
      }],
      assessment_evidence_refs: evidence?.observations
        .filter((observation) => observation.evidenceClass === "assessment_performance")
        .map((observation) => observation.evidenceRef)
        .sort() ?? [],
    },
  };
}
