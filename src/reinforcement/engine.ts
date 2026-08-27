import type { ProtocolValidator } from "../protocol/validator.js";
import type { PackageImporter } from "../storage/package-importer.js";
import type { ReinforcementStore } from "../storage/reinforcement-store.js";
import type { LearningTimezoneStore } from "../storage/learning-timezone-store.js";
import type { SessionStore } from "../storage/session-store.js";
import type { AppendOnlyEventStore } from "../storage/event-store.js";
import { collectAuthoritativeEvidence } from "./evidence.js";
import { projectMission } from "./mission.js";
import { evaluatePolicy, type ReinforcementEvaluation } from "./policy.js";
import { projectEffectiveStreak } from "./streak.js";
import type { Document, ReinforcementEvidenceSource } from "./types.js";

export interface RuntimeReinforcementEvaluation extends ReinforcementEvaluation {
  mission: ReturnType<typeof projectMission>;
  streak: ReturnType<typeof projectEffectiveStreak>;
}

interface ReinforcementEngineOptions {
  learnerId: string;
  now: () => string;
  validator: ProtocolValidator;
  importer: PackageImporter;
  sessions: SessionStore;
  events: AppendOnlyEventStore;
  store: ReinforcementStore;
  learningTimezone: LearningTimezoneStore;
  inspectSession: (sessionId: string) => { status: string };
}

export class ReinforcementEngine {
  constructor(private readonly options: ReinforcementEngineOptions) {}

  evaluate(sessionId: string): RuntimeReinforcementEvaluation {
    const sources = this.#sources();
    const targetSource = sources.find((source) => source.session.session_id === sessionId);
    if (targetSource?.inspectionStatus !== "AUTHORITATIVE" || targetSource.session.state !== "COMPLETED") {
      throw new Error(`target reinforcement evidence is not authoritative: ${sessionId}`);
    }
    const evidence = collectAuthoritativeEvidence(sources);
    const targetEvidence = evidence.find((item) => item.sessionId === sessionId);
    if (targetEvidence === undefined) throw new Error(`target reinforcement evidence is not authoritative: ${sessionId}`);
    const historical = this.options.store.listDecisions().find((decision) => (
      decision.decision_type === "historical_award"
      && decision.learner_id === this.options.learnerId
      && targetEvidence.targetSkills.includes(decision.skill_id)
      && targetEvidence.hypothesisRefs.includes(decision.error_pattern_id)
    ));
    const now = this.options.now();
    const latestEvidenceAt = evidence.map((item) => item.completedAt)
      .sort((left, right) => Date.parse(left) - Date.parse(right)).at(-1) ?? targetEvidence.completedAt;
    const evaluatedAt = Date.parse(now) < Date.parse(latestEvidenceAt) ? latestEvidenceAt : now;
    const timezone = this.options.learningTimezone.read();
    if (timezone === undefined) throw new Error("learning timezone is not configured");
    const learningDays = evidence
      .filter((session) => session.hasLegitimateParticipation && !session.clockAnomaly)
      .map((session) => this.options.learningTimezone.assignLearningDay({
        sessionId: session.sessionId,
        completedAt: session.completedAt,
      }));
    const currentQualification = historical === undefined
      ? undefined
      : this.options.store.readQualification(
        this.options.learnerId,
        historical.skill_id as string,
        historical.error_pattern_id as string,
      );
    const evaluation = evaluatePolicy({
      learnerId: this.options.learnerId,
      targetSessionId: sessionId,
      sessions: evidence,
      learningDays,
      learningTimezone: timezone,
      evaluatedAt,
      ...(historical === undefined ? {} : { existingHistoricalAward: historical }),
      ...(currentQualification === undefined ? {} : { existingCurrentQualification: currentQualification }),
    });
    const evidenceIds = new Set<string>(sources.flatMap((source) => source.events.map((event) => event.event_id as string)));
    if (evaluation.historicalDecision !== undefined) {
      this.options.validator.validateReinforcementDecision(evaluation.historicalDecision, evidenceIds);
      this.options.store.publishDecision(evaluation.historicalDecision);
    }
    if (evaluation.qualificationUpdate !== undefined) {
      this.options.validator.validateReinforcementDecision(evaluation.qualificationUpdate, evidenceIds);
      this.options.store.publishDecision(evaluation.qualificationUpdate);
    }
    if (evaluation.currentQualification !== undefined) this.options.store.publishQualification(evaluation.currentQualification);
    const packageDocument = targetSource.packageDocument;
    return {
      ...evaluation,
      mission: projectMission(packageDocument, { state: targetSource.session.state as string }, targetEvidence, evaluation.currentQualification),
      streak: projectEffectiveStreak(learningDays, evaluatedAt, timezone),
    };
  }

  mission(identifier: string): ReturnType<typeof projectMission> {
    const all = this.options.sessions.list();
    const direct = all.find((session) => session.session_id === identifier);
    const runSessions = all.filter((item) => item.run_id === identifier);
    const leaves = runSessions.filter((candidate) => !runSessions.some((item) => item.prior_session_id === candidate.session_id));
    if (direct === undefined && leaves.length > 1) throw new Error(`run has multiple current mission leaves: ${identifier}`);
    const session = direct ?? leaves[0];
    if (session === undefined) throw new Error(`session or run does not exist: ${identifier}`);
    const packageDocument = this.options.importer.loadPackage(session.package_id);
    const evidence = collectAuthoritativeEvidence(this.#sources()).find((item) => item.sessionId === session.session_id);
    const hypothesis = (packageDocument.training_hypotheses as Document[])[0]?.hypothesis_id as string | undefined;
    const skill = (packageDocument.target_skills as string[])[0];
    const qualification = hypothesis === undefined || skill === undefined
      ? undefined
      : this.options.store.readQualification(this.options.learnerId, skill, hypothesis);
    return projectMission(packageDocument, session, evidence, qualification);
  }

  #sources(): ReinforcementEvidenceSource[] {
    return this.options.sessions.list().map((session) => {
      const inspectionStatus = session.state === "COMPLETED"
        ? this.options.inspectSession(session.session_id).status
        : session.state === "QUARANTINED" ? "QUARANTINED" : "VALID_INCOMPLETE";
      const result = this.options.sessions.readResult(session.session_id);
      return {
        inspectionStatus,
        session: this.options.sessions.read(session.session_id),
        packageDocument: this.options.importer.loadPackage(session.package_id),
        ...(result === undefined ? {} : { result }),
        events: this.options.events.read(session.session_id),
      };
    });
  }
}
