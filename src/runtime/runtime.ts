import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";

import { canonicalHash, parseJsonStrict } from "../protocol/canonical.js";
import { createProtocolValidator, type ProtocolValidator } from "../protocol/validator.js";
import { ArtifactStore } from "../storage/artifact-store.js";
import { CheckpointStore } from "../storage/checkpoint-store.js";
import { CoachExchange, type ContinuationBinding } from "../storage/coach-exchange.js";
import { AppendOnlyEventStore, type EventContext } from "../storage/event-store.js";
import { PackageImporter, type ImportRecord } from "../storage/package-importer.js";
import { ReinforcementStore } from "../storage/reinforcement-store.js";
import {
  LearningTimezoneStore,
  type LearningTimezoneEpoch,
  type LearningTimezoneSettings,
} from "../storage/learning-timezone-store.js";
import { SessionStore, type SessionMetadata } from "../storage/session-store.js";
import { initializeWorkspace } from "../storage/workspace.js";
import type { RuntimeWorkspace } from "../storage/workspace.js";
import { continuationSessionId, priorEvidenceFingerprint } from "./continuation.js";
import { ReinforcementEngine } from "../reinforcement/engine.js";
import { projectReveal } from "../reinforcement/reveal.js";
import { projectLearnerActivity } from "./projection.js";
import { deriveSessionResult } from "./result.js";
import { transitionState } from "./state-machine.js";
import { projectEffectiveStreak } from "../reinforcement/streak.js";
import { projectMission } from "../reinforcement/mission.js";
import {
  BAND8_IELTS_GOAL,
  projectIeltsGoal,
  type CoachProductStatus,
  type CoachProjection,
  type HistoryOptions,
  type HistoryProjection,
  type ProgressProjection,
  type TodayProjection,
  type TrainingProjection,
  type WorkspaceInformationProjection,
} from "./product-projection.js";

type Document = Record<string, any>;

export interface RuntimeOptions {
  repositoryRoot: string;
  workspacePath: string;
  eventIdFactory?: () => string;
  artifactIdFactory?: () => string;
  now?: () => string;
  learnerId?: string;
  timezoneEpochIdFactory?: () => string;
}

export type InspectionStatus = "AUTHORITATIVE" | "VALID_INCOMPLETE" | "REBUILD_REQUIRED" | "QUARANTINED";

export class UnsupportedRuntimePrimitiveError extends Error {
  constructor(type: string) {
    super(`UNSUPPORTED_RUNTIME_PRIMITIVE: ${type}`);
    this.name = "UnsupportedRuntimePrimitiveError";
  }
}

export class Band8Runtime {
  readonly #validator: ProtocolValidator;
  readonly #importer: PackageImporter;
  readonly #sessions: SessionStore;
  readonly #artifacts: ArtifactStore;
  readonly #checkpoints: CheckpointStore;
  readonly #coach: CoachExchange;
  readonly #events: AppendOnlyEventStore;
  readonly #reinforcement: ReinforcementEngine;
  readonly #reinforcementStore: ReinforcementStore;
  readonly #learningTimezone: LearningTimezoneStore;
  readonly #workspace: RuntimeWorkspace;
  readonly #now: () => string;
  readonly #artifactIdFactory: () => string;

  private constructor(options: RuntimeOptions) {
    const workspace = initializeWorkspace(options.workspacePath);
    this.#workspace = workspace;
    this.#validator = createProtocolValidator(options.repositoryRoot);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#artifactIdFactory = options.artifactIdFactory ?? (() => `artifact-${randomUUID()}`);
    this.#importer = new PackageImporter(workspace, this.#validator, this.#now);
    this.#sessions = new SessionStore(workspace);
    this.#artifacts = new ArtifactStore(workspace, this.#validator);
    this.#checkpoints = new CheckpointStore(workspace, this.#validator);
    this.#coach = new CoachExchange(workspace);
    this.#events = new AppendOnlyEventStore(
      workspace,
      this.#validator,
      options.eventIdFactory ?? (() => `event-${randomUUID()}`),
      () => ({ artifacts: this.#artifacts.metadataById(), artifactRoot: this.#artifacts.root }),
    );
    const reinforcementStore = new ReinforcementStore(workspace, this.#validator);
    this.#reinforcementStore = reinforcementStore;
    this.#learningTimezone = new LearningTimezoneStore(
      workspace,
      this.#now,
      options.timezoneEpochIdFactory ?? (() => `timezone-epoch-${randomUUID()}`),
    );
    this.#reinforcement = new ReinforcementEngine({
      learnerId: options.learnerId ?? "learner-local-default",
      now: this.#now,
      validator: this.#validator,
      importer: this.#importer,
      sessions: this.#sessions,
      events: this.#events,
      store: reinforcementStore,
      learningTimezone: this.#learningTimezone,
      inspectSession: (sessionId) => this.inspectSession(sessionId),
    });
  }

  static open(options: RuntimeOptions): Band8Runtime {
    return new Band8Runtime(options);
  }

  importPackage(packageText: string, protectedText?: string): ReturnType<PackageImporter["importFromText"]> {
    return protectedText === undefined
      ? this.#importer.importFromText(packageText)
      : this.#importer.importFromText(packageText, protectedText);
  }

  createSession(packageId: string, sessionId: string): SessionMetadata {
    if (this.#sessions.exists(sessionId)) throw new Error(`session already exists: ${sessionId}`);
    const packageDocument = this.#importer.loadPackage(packageId);
    const created: SessionMetadata = {
      session_id: sessionId,
      run_id: packageDocument.run_id,
      segment_id: packageDocument.segment_id,
      package_id: packageId,
      state: "CREATED",
      current_activity_index: 0,
      completed_activity_ids: [],
    };
    this.#sessions.write(created);
    const ready = { ...created, state: transitionState(created.state, "READY") };
    this.#sessions.write(ready);
    return ready;
  }

  startSession(sessionId: string): SessionMetadata {
    const session = this.#sessions.read(sessionId);
    if (session.state !== "READY") throw new Error(`session is not READY: ${sessionId}`);
    const packageDocument = this.#importer.loadPackage(session.package_id);
    this.#append(session, packageDocument, "session_started", null, {
      run_id: session.run_id,
      segment_id: session.segment_id,
      mode: packageDocument.session_intent.mode,
    });
    const running = { ...session, state: transitionState(session.state, "RUNNING") };
    this.#sessions.write(running);
    return running;
  }

  currentActivity(sessionId: string): ReturnType<typeof projectLearnerActivity> {
    const session = this.#sessions.read(sessionId);
    if (session.state !== "RUNNING") throw new Error(`session is not RUNNING: ${sessionId}`);
    const packageDocument = this.#importer.loadPackage(session.package_id);
    const activity = packageDocument.activities[session.current_activity_index] as Document | undefined;
    if (activity === undefined) throw new Error("session has no current activity");
    return projectLearnerActivity(packageDocument, activity);
  }

  completeCurrentActivity(sessionId: string, response?: { optionIds?: string[]; text?: string }): { state: SessionMetadata["state"]; result?: Document } {
    const session = this.#sessions.read(sessionId);
    if (session.state !== "RUNNING") throw new Error(`session is not RUNNING: ${sessionId}`);
    const packageDocument = this.#importer.loadPackage(session.package_id);
    const activity = packageDocument.activities[session.current_activity_index] as Document | undefined;
    if (activity === undefined) throw new Error("session has no current activity");
    this.#assertSupported(activity);
    this.#validateResponse(activity, response);

    this.#append(session, packageDocument, "activity_started", activity.activity_id, {
      attempt_id: activity.attempt_id,
    });
    if (activity.type === "SELECT") {
      const optionIds = [...(response?.optionIds ?? [])];
      this.#append(session, packageDocument, "answer_selected", activity.activity_id, {
        attempt_id: activity.attempt_id,
        option_ids: optionIds,
      });
      this.#append(session, packageDocument, "answer_submitted", activity.activity_id, {
        attempt_id: activity.attempt_id,
        response_kind: "selection",
        option_ids: optionIds,
      });
    } else if (activity.type === "TEXT_RESPONSE") {
      const relationships = activity.relationships as Document;
      if (relationships.revision_of !== null) {
        if (relationships.feedback_ref === null || relationships.source_output_ref === null) {
          throw new Error("TEXT_RESPONSE revision requires feedback_ref and source_output_ref");
        }
        this.#append(session, packageDocument, "correction_started", activity.activity_id, {
          attempt_id: activity.attempt_id,
          revision_of: relationships.revision_of,
          feedback_ref: relationships.feedback_ref,
          source_output_ref: relationships.source_output_ref,
        });
      }
      const artifactId = this.#artifactIdFactory();
      this.#artifacts.commitText(
        { sessionId, runId: session.run_id, segmentId: session.segment_id, packageId: session.package_id },
        { activityId: activity.activity_id, artifactType: activity.output_contract.artifact_type },
        artifactId,
        response?.text ?? "",
        this.#now(),
      );
      this.#append(session, packageDocument, "answer_submitted", activity.activity_id, {
        attempt_id: activity.attempt_id,
        response_kind: "text",
        text_value: response?.text ?? "",
        output_ref: artifactId,
      });
      if (relationships.revision_of !== null) {
        this.#append(session, packageDocument, "writing_revision_created", activity.activity_id, {
          attempt_id: activity.attempt_id,
          artifact_id: artifactId,
          revision_of: relationships.revision_of,
        });
      }
      this.#append(session, packageDocument, "artifact_created", activity.activity_id, { artifact_id: artifactId });
      if (relationships.revision_of !== null) {
        this.#append(session, packageDocument, "correction_submitted", activity.activity_id, {
          attempt_id: activity.attempt_id,
          revision_of: relationships.revision_of,
          feedback_ref: relationships.feedback_ref,
          source_output_ref: relationships.source_output_ref,
          output_ref: artifactId,
        });
      }
    }
    this.#append(session, packageDocument, "activity_completed", activity.activity_id, {
      attempt_id: activity.attempt_id,
    });

    const completed = [...session.completed_activity_ids, activity.activity_id];
    const advanced: SessionMetadata = {
      ...session,
      current_activity_index: session.current_activity_index + 1,
      completed_activity_ids: completed,
    };
    if (advanced.current_activity_index < packageDocument.activities.length) {
      this.#sessions.write(advanced);
      return { state: advanced.state };
    }

    const checkpointConfiguration = packageDocument.completion_policy.coach_checkpoint as Document | null;
    if (checkpointConfiguration !== null) {
      const sourceActivities = new Set<string>(checkpointConfiguration.source_activity_ids);
      const requiredEvidenceRefs = this.#artifacts.listForSession(sessionId)
        .filter((metadata) => sourceActivities.has(metadata.source_activity_id))
        .map((metadata) => metadata.artifact_id as string)
        .sort();
      if (requiredEvidenceRefs.length === 0) throw new Error("Coach checkpoint has no committed source artifacts");
      const manifest: Document = {
        schema_version: "0.1.0",
        protocol_version: "0.1.0",
        checkpoint_id: checkpointConfiguration.checkpoint_id,
        checkpoint_reason: checkpointConfiguration.checkpoint_reason,
        created_at: this.#now(),
        session_id: sessionId,
        run_id: advanced.run_id,
        segment_id: advanced.segment_id,
        package_id: advanced.package_id,
        package_hash: canonicalHash(packageDocument),
        required_evidence_refs: requiredEvidenceRefs,
        status: "awaiting_coach",
      };
      this.#checkpoints.write(sessionId, manifest, packageDocument);
      this.#append(advanced, packageDocument, "coach_checkpoint_reached", null, {
        checkpoint_id: checkpointConfiguration.checkpoint_id,
        required_evidence_refs: requiredEvidenceRefs,
      });
      const awaiting: SessionMetadata = {
        ...advanced,
        state: transitionState(advanced.state, "AWAITING_COACH"),
        checkpoint_id: checkpointConfiguration.checkpoint_id,
      };
      this.#sessions.write(awaiting);
      return { state: awaiting.state };
    }

    this.#append(advanced, packageDocument, "session_completed", null, {
      completed_activity_ids: completed,
    });
    const terminal: SessionMetadata = { ...advanced, state: transitionState(advanced.state, "COMPLETED") };
    this.#sessions.write(terminal);
    const result = this.#deriveAndValidate(terminal);
    this.#sessions.writeResult(sessionId, result);
    return { state: terminal.state, result };
  }

  inspectSession(sessionId: string): { status: InspectionStatus; reason?: string } {
    const session = this.#sessions.read(sessionId);
    const packageDocument = this.#importer.loadPackage(session.package_id);
    let events: Document[];
    try {
      events = this.#events.read(sessionId);
      const reconciliation = this.#artifacts.reconcile(sessionId, events);
      if (reconciliation.status === "INVALID") {
        throw new Error(`artifact reconciliation failed: ${reconciliation.invalid.map((issue) => issue.reason).join("; ")}`);
      }
      const verdict = this.#validator.validateEventStream(events, {
        packageDocument,
        mode: ["COMPLETED", "ABORTED", "AWAITING_COACH"].includes(session.state) ? "complete" : "prefix",
        artifacts: this.#artifacts.metadataById(),
        artifactRoot: this.#artifacts.root,
      });
      if (verdict.state === "VALID_INCOMPLETE") return { status: "VALID_INCOMPLETE" };
      if (verdict.state === "AWAITING_COACH") {
        const checkpoint = this.#checkpoints.read(sessionId);
        this.#validator.validateCheckpoint(checkpoint, packageDocument);
        if (JSON.stringify([...checkpoint.required_evidence_refs].sort()) !== JSON.stringify([...events.at(-1)!.payload.required_evidence_refs].sort())) {
          throw new Error("checkpoint manifest evidence differs from terminal event");
        }
        if (session.state === "RUNNING") {
          this.#sessions.write({
            ...session,
            state: "AWAITING_COACH",
            current_activity_index: packageDocument.activities.length,
            completed_activity_ids: events
              .filter((event) => event.event_type === "activity_completed")
              .map((event) => event.activity_id as string),
            checkpoint_id: checkpoint.checkpoint_id,
          });
        } else if (session.state !== "AWAITING_COACH") {
          throw new Error(`session metadata state ${session.state} contradicts checkpoint evidence`);
        }
        return { status: "AUTHORITATIVE" };
      }
      const result = this.#sessions.readResult(sessionId);
      if (result === undefined) return { status: "REBUILD_REQUIRED" };
      const protectedEvaluation = this.#importer.loadProtected(session.package_id);
      this.#validator.validateResult(result, events, packageDocument, protectedEvaluation, {
        artifacts: this.#artifacts.metadataById(),
        artifactRoot: this.#artifacts.root,
      });
      return { status: "AUTHORITATIVE" };
    } catch (error) {
      const reason = `event/result integrity failure: ${error instanceof Error ? error.message : String(error)}`;
      this.#quarantine(session, reason);
      return { status: "QUARANTINED", reason };
    }
  }

  resumeSession(sessionId: string, operationId: string): { status: "RESUMED" | "IDEMPOTENT" } {
    const session = this.#sessions.read(sessionId);
    const packageDocument = this.#importer.loadPackage(session.package_id);
    const events = this.#events.read(sessionId);
    if (events.some((event) => event.event_type === "session_resumed" && event.payload.resume_operation_id === operationId)) {
      return { status: "IDEMPOTENT" };
    }
    this.#validator.validateEventStream(events, {
      packageDocument,
      mode: "prefix",
      artifacts: this.#artifacts.metadataById(),
      artifactRoot: this.#artifacts.root,
    });
    let suspended = session;
    if (session.state === "RUNNING") {
      this.#append(session, packageDocument, "session_suspended", null, { reason: "runtime_restart_recovery" });
      suspended = { ...session, state: transitionState(session.state, "SUSPENDED") };
      this.#sessions.write(suspended);
    }
    if (suspended.state !== "SUSPENDED") throw new Error(`session cannot resume from ${suspended.state}`);
    this.#append(suspended, packageDocument, "session_resumed", null, { resume_operation_id: operationId });
    this.#sessions.write({ ...suspended, state: transitionState(suspended.state, "RUNNING") });
    return { status: "RESUMED" };
  }

  events(sessionId: string): Document[] {
    return this.#events.read(sessionId);
  }

  learningTimezone(): LearningTimezoneSettings | undefined {
    return this.#learningTimezone.read();
  }

  configureLearningTimezone(timeZone: string): LearningTimezoneEpoch {
    return this.#learningTimezone.configure(timeZone);
  }

  changeLearningTimezone(timeZone: string): LearningTimezoneEpoch {
    return this.#learningTimezone.change(timeZone);
  }

  today(): TodayProjection {
    const packages = this.#importer.list();
    const session = this.#currentProductSession();
    const unstarted = this.#latestUnstartedPackage();
    const projectUnstarted = unstarted !== undefined && (session === undefined || ["COMPLETED", "ABORTED", "QUARANTINED"].includes(session.state));
    const timezone = this.#learningTimezone.read();
    const completed = this.#sessions.list()
      .filter((candidate) => candidate.state === "COMPLETED")
      .sort((left, right) => this.#sessionTimestamp(left).localeCompare(this.#sessionTimestamp(right)));
    const latestCompleted = completed.at(-1);
    const packageDocument = projectUnstarted
      ? this.#importer.loadPackage(unstarted.package_id)
      : session === undefined ? undefined : this.#importer.loadPackage(session.package_id);
    return {
      empty: packages.length === 0,
      goal: projectIeltsGoal(packageDocument?.learner_goal as Document | undefined),
      mission: projectUnstarted
        ? projectMission(packageDocument!, { state: "READY" })
        : session === undefined ? null : this.mission(session.session_id),
      effective_streak: timezone === undefined ? null : projectEffectiveStreak(
        this.#learningTimezone.listLearningDays(),
        this.#now(),
        timezone,
      ),
      last_reveal: latestCompleted === undefined || timezone === undefined ? null : this.reveal(latestCompleted.session_id),
      coach_status: this.#coachProductStatus(),
      primary_action: packages.length === 0
        ? "GO_TO_COACH"
        : session?.state === "AWAITING_COACH" ? "GO_TO_COACH" : "CONTINUE_TRAINING",
    };
  }

  training(): TrainingProjection | null {
    const session = this.#currentProductSession();
    const unstarted = this.#latestUnstartedPackage();
    if (unstarted !== undefined && (session === undefined || ["COMPLETED", "ABORTED", "QUARANTINED"].includes(session.state))) {
      return {
        session_id: null,
        package_id: unstarted.package_id,
        state: "READY_TO_START",
        activity_number: 0,
        activity_count: this.#importer.loadPackage(unstarted.package_id).activities.length,
        mission: null,
        current_activity: null,
        integrity: { status: "OK" },
      };
    }
    if (session === undefined) return null;
    const packageDocument = this.#importer.loadPackage(session.package_id);
    return {
      session_id: session.session_id,
      package_id: session.package_id,
      state: session.state,
      activity_number: Math.min(session.current_activity_index + 1, packageDocument.activities.length),
      activity_count: packageDocument.activities.length,
      mission: this.mission(session.session_id),
      current_activity: session.state === "RUNNING" ? this.currentActivity(session.session_id) : null,
      integrity: session.state === "QUARANTINED" ? { status: this.inspectSession(session.session_id).status } : { status: "OK" },
    };
  }

  beginTraining(packageId?: string, sessionId?: string): TrainingProjection {
    let session: SessionMetadata;
    if (sessionId !== undefined) session = this.#sessions.read(sessionId);
    else {
      const active = this.#sessions.list().find((candidate) => ["READY", "RUNNING", "SUSPENDED"].includes(candidate.state));
      if (active !== undefined) session = active;
      else {
        const selected = packageId ?? this.#latestUnstartedPackage()?.package_id;
        if (selected === undefined) throw new Error("no training package is imported");
        session = this.createSession(selected, `session-${randomUUID()}`);
      }
    }
    if (session.state === "READY") this.startSession(session.session_id);
    else if (session.state === "SUSPENDED") this.resumeSession(session.session_id, `resume-${randomUUID()}`);
    else if (session.state !== "RUNNING") throw new Error(`session cannot begin training from ${session.state}`);
    return this.training()!;
  }

  submitCurrentActivity(sessionId: string, response?: { optionIds?: string[]; text?: string }): Document {
    const activity = this.currentActivity(sessionId);
    const beforeArtifacts = new Set(this.#artifacts.listForSession(sessionId).map((item) => item.artifact_id as string));
    const completion = this.completeCurrentActivity(sessionId, response);
    const createdArtifacts = this.#artifacts.listForSession(sessionId)
      .filter((item) => !beforeArtifacts.has(item.artifact_id as string))
      .map((item) => ({
        artifact_id: item.artifact_id,
        artifact_type: item.artifact_type,
        content_hash: item.content_hash,
        created_at: item.created_at,
      }));
    const objective = completion.result?.objective_results?.find((item: Document) => item.activity_id === activity.activity_id) as Document | undefined;
    const payload: Document = {
      state: completion.state,
      submission: {
        activity_id: activity.activity_id,
        ...(objective?.outcome === undefined ? {} : { outcome: objective.outcome, evidence_refs: objective.evidence_refs }),
      },
      artifacts: createdArtifacts,
      training: this.training(),
    };
    if (completion.state === "COMPLETED") {
      payload.reinforcement = this.evaluateReinforcement(sessionId);
      payload.reveal = this.reveal(sessionId);
    }
    if (completion.state === "AWAITING_COACH") payload.coach = this.coachStatus();
    return payload;
  }

  coachStatus(): CoachProjection {
    const sessions = this.#sessions.list();
    const continuation = sessions.find((session) => session.prior_session_id !== undefined && ["READY", "RUNNING"].includes(session.state));
    if (continuation !== undefined) return { status: "CONTINUATION_READY", session_id: continuation.session_id };
    const awaiting = sessions.find((session) => session.state === "AWAITING_COACH"
      && !sessions.some((candidate) => candidate.prior_session_id === session.session_id));
    if (awaiting !== undefined) {
      const checkpoint = this.#checkpoints.read(awaiting.session_id);
      return {
        status: "REVIEW_REQUIRED",
        session_id: awaiting.session_id,
        checkpoint_id: checkpoint.checkpoint_id,
        evidence_count: checkpoint.required_evidence_refs.length,
        evidence_refs: checkpoint.required_evidence_refs,
        bundle_identity: `coach-bundle:${checkpoint.checkpoint_id}`,
      };
    }
    return { status: this.#importer.list().length === 0 ? "NO_PACKAGE" : "TRAINING_READY" };
  }

  progress(): ProgressProjection {
    const sessions = this.#sessions.list();
    const leaves = sessions.filter((candidate) => !sessions.some((item) => item.prior_session_id === candidate.session_id));
    const completed = sessions.filter((session) => session.state === "COMPLETED");
    const latest = completed.sort((left, right) => this.#sessionTimestamp(left).localeCompare(this.#sessionTimestamp(right))).at(-1);
    const reinforcement = latest === undefined || this.#learningTimezone.read() === undefined
      ? undefined
      : this.evaluateReinforcement(latest.session_id);
    return {
      goal: projectIeltsGoal(BAND8_IELTS_GOAL),
      missions: leaves.map((session) => this.mission(session.session_id)),
      validated_qualifications: this.#reinforcementStore.listQualifications().map((qualification) => ({
        skill_id: qualification.skill_id as string,
        error_pattern_id: qualification.error_pattern_id as string,
        qualification: qualification.qualification as string,
        evaluated_at: qualification.evaluated_at as string,
      })),
      retention: reinforcement?.eligible.some((item) => item.event_type === "RETENTION_CONFIRMED") ? "CONFIRMED" : "EVIDENCE_PENDING",
      transfer: reinforcement?.eligible.some((item) => item.event_type === "TRANSFER_CONFIRMED") ? "CONFIRMED" : "EVIDENCE_PENDING",
      pattern_status: reinforcement?.currentQualification?.qualification === "revoked"
        ? "NEEDS_REVALIDATION"
        : reinforcement?.eligible.some((item) => item.event_type === "PATTERN_BROKEN") ? "PATTERN_BROKEN" : "EVIDENCE_PENDING",
    };
  }

  history(options: HistoryOptions = {}): HistoryProjection {
    const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
    const cursor = Math.max(0, options.cursor ?? 0);
    const sessions = this.#sessions.list().sort((left, right) => this.#sessionTimestamp(right).localeCompare(this.#sessionTimestamp(left)));
    const page = sessions.slice(cursor, cursor + limit).map((session) => {
      const packageDocument = this.#importer.loadPackage(session.package_id);
      const integrity = this.inspectSession(session.session_id);
      const currentSession = this.#sessions.read(session.session_id);
      if (integrity.status === "QUARANTINED") {
        return {
          session_id: session.session_id,
          state: currentSession.state,
          objective: packageDocument.session_intent.objective,
          target_skills: packageDocument.target_skills,
          started_at: null,
          completed_at: null,
          submissions: [],
          artifacts: [],
          corrections: [],
          reveal: null,
          integrity: { status: "QUARANTINED" },
        };
      }
      const events = this.#events.read(session.session_id);
      const result = this.#sessions.readResult(session.session_id);
      const artifacts = this.#artifacts.listForSession(session.session_id).map((metadata) => ({
        artifact_id: metadata.artifact_id,
        artifact_type: metadata.artifact_type,
        created_at: metadata.created_at,
        content_hash: metadata.content_hash,
        text: this.#artifacts.loadText(metadata.artifact_id),
      }));
      return {
        session_id: session.session_id,
        state: currentSession.state,
        objective: packageDocument.session_intent.objective,
        target_skills: packageDocument.target_skills,
        started_at: events[0]?.timestamp ?? null,
        completed_at: result?.completed_at ?? null,
        submissions: events.filter((event) => event.event_type === "answer_submitted").map((event) => ({
          activity_id: event.activity_id,
          response_kind: event.payload.response_kind,
          ...(event.payload.option_ids === undefined ? {} : { option_ids: event.payload.option_ids }),
          ...(event.payload.text_value === undefined ? {} : { text: event.payload.text_value }),
          evidence_ref: event.event_id,
        })),
        artifacts,
        corrections: result?.corrections ?? [],
        reveal: currentSession.state === "COMPLETED" && integrity.status === "AUTHORITATIVE" && this.#learningTimezone.read() !== undefined ? this.reveal(session.session_id) : null,
        integrity: { status: integrity.status },
      };
    });
    return { items: page, next_cursor: cursor + page.length < sessions.length ? cursor + page.length : null };
  }

  workspaceInformation(): WorkspaceInformationProjection {
    const timezone = this.#learningTimezone.read();
    const currentEpoch = timezone?.epochs.find((epoch) => epoch.timezone_epoch_id === timezone.timezone_epoch_id);
    return {
      data_location: this.#workspace.root,
      learning_timezone: timezone === undefined || currentEpoch === undefined ? null : {
        learning_timezone: timezone.learning_timezone,
        timezone_epoch_id: timezone.timezone_epoch_id,
        effective_from: currentEpoch.effective_from,
        created_at: currentEpoch.created_at,
      },
      local_only: true,
    };
  }

  evaluateReinforcement(sessionId: string): ReturnType<ReinforcementEngine["evaluate"]> {
    return this.#reinforcement.evaluate(sessionId);
  }

  mission(identifier: string): ReturnType<ReinforcementEngine["mission"]> {
    return this.#reinforcement.mission(identifier);
  }

  reveal(sessionId: string): ReturnType<typeof projectReveal> {
    return projectReveal(this.evaluateReinforcement(sessionId));
  }

  readArtifactText(artifactId: string): string {
    return this.#artifacts.loadText(artifactId);
  }

  checkpoint(sessionId: string): Document {
    return this.#checkpoints.read(sessionId);
  }

  exportCheckpoint(sessionId: string): { manifestPath: string; bundlePath: string; bundle: Document } {
    if (this.inspectSession(sessionId).status !== "AUTHORITATIVE") throw new Error("checkpoint evidence is not authoritative");
    const session = this.#sessions.read(sessionId);
    if (session.state !== "AWAITING_COACH") throw new Error(`session is not AWAITING_COACH: ${sessionId}`);
    const checkpoint = this.#checkpoints.read(sessionId);
    const packageDocument = this.#importer.loadPackage(session.package_id);
    const configured = packageDocument.completion_policy.coach_checkpoint as Document;
    const artifacts = (checkpoint.required_evidence_refs as string[]).map((artifactId) => ({
      metadata: this.#artifacts.loadMetadata(artifactId),
      contentPath: this.#artifacts.contentPath(artifactId),
    }));
    return this.#coach.export(
      checkpoint,
      packageDocument,
      this.#importer.record(session.package_id),
      this.#events.path(sessionId),
      artifacts,
      configured.source_activity_ids,
    );
  }

  exportCheckpointDownload(sessionId: string): Document {
    const exported = this.exportCheckpoint(sessionId);
    const bundleDirectory = dirname(exported.bundlePath);
    const records = (exported.bundle.records as Document[]).map((record) => {
      const target = resolve(bundleDirectory, record.relative_path as string);
      const inside = relative(this.#workspace.root, target);
      if (inside === "" || inside.startsWith("..") || resolve(this.#workspace.root, inside) !== target) {
        throw new Error("Coach bundle record resolved outside the Runtime workspace");
      }
      const bytes = readFileSync(target);
      const actualHash = record.record_kind === "training_package"
        ? canonicalHash(parseJsonStrict(bytes.toString("utf8")))
        : `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (actualHash !== record.content_hash) throw new Error("Coach bundle record hash verification failed");
      const { relative_path: _relativePath, ...safeRecord } = record;
      return {
        ...safeRecord,
        media_type: record.record_kind === "raw_event_stream" ? "application/x-ndjson" : record.record_kind === "learner_artifact" ? "text/plain; charset=utf-8" : "application/json",
        content: bytes.toString("utf8"),
      };
    });
    const { manifest_ref: _manifestRef, records: _recordReferences, ...coachBundle } = exported.bundle;
    return {
      schema_version: "0.1.0",
      api_version: "v1",
      bundle_type: "band8_coach_download",
      trust_classification: "DATA_ONLY",
      checkpoint_id: exported.bundle.checkpoint_id,
      coach_bundle: coachBundle,
      checkpoint_manifest: parseJsonStrict(readFileSync(exported.manifestPath, "utf8")),
      records,
    };
  }

  attachContinuation(priorSessionId: string, packageText: string): { status: "ATTACHED" | "IDEMPOTENT"; sessionId: string; packageId: string } {
    if (this.inspectSession(priorSessionId).status !== "AUTHORITATIVE") throw new Error("prior checkpoint evidence is not authoritative");
    const priorSession = this.#sessions.read(priorSessionId);
    if (priorSession.state !== "AWAITING_COACH") throw new Error(`prior session is not AWAITING_COACH: ${priorSessionId}`);
    const priorPackage = this.#importer.loadPackage(priorSession.package_id);
    const checkpoint = this.#checkpoints.read(priorSessionId);
    const continuationPackage = parseJsonStrict(packageText) as Document;
    this.#validator.validateContinuation(continuationPackage, priorPackage, checkpoint);

    const priorEvents = this.#events.read(priorSessionId);
    const availableReferences = new Set<string>([
      ...priorEvents.map((event) => event.event_id as string),
      ...this.#artifacts.listForSession(priorSessionId).map((metadata) => metadata.artifact_id as string),
    ]);
    const priorArtifactIds = new Set<string>(this.#artifacts.listForSession(priorSessionId).map((metadata) => metadata.artifact_id as string));
    const declaredAvailable = continuationPackage.available_evidence_refs as string[] | undefined;
    if (declaredAvailable?.some((reference) => !availableReferences.has(reference))) {
      throw new Error("continuation declares unavailable prior evidence");
    }
    if ((continuationPackage.continuation.required_evidence_refs as string[]).some((reference) => !availableReferences.has(reference))) {
      throw new Error("continuation required evidence does not exist");
    }
    const priorOutputsByAttempt = new Map<string, string>();
    const priorAttemptIds = new Set<string>((priorPackage.activities as Document[]).map((activity) => activity.attempt_id as string));
    for (const event of priorEvents) {
      if (event.event_type === "answer_submitted" && typeof event.payload.output_ref === "string") {
        priorOutputsByAttempt.set(event.payload.attempt_id as string, event.payload.output_ref as string);
      }
    }
    for (const activity of continuationPackage.activities as Document[]) {
      const relationships = activity.relationships as Document;
      if ((relationships.prior_evidence_refs as string[]).some((reference) => !availableReferences.has(reference))) {
        throw new Error("continuation activity cites unavailable prior evidence");
      }
      if (relationships.source_output_ref !== null && !priorArtifactIds.has(relationships.source_output_ref)) {
        throw new Error("continuation source_output_ref is not a verified prior artifact");
      }
      const revisionOf = relationships.revision_of as string | null;
      if (revisionOf !== null && priorAttemptIds.has(revisionOf)) {
        const expectedOutput = priorOutputsByAttempt.get(revisionOf);
        if (expectedOutput === undefined) throw new Error("continuation revision target has no prior artifact output");
        if (relationships.source_output_ref !== expectedOutput) {
          throw new Error("continuation revision source does not match the prior attempt artifact");
        }
      }
    }
    if ((continuationPackage.training_rationale.evidence_refs as string[]).some((reference) => !availableReferences.has(reference))) {
      throw new Error("continuation rationale cites unavailable prior evidence");
    }
    const childSessionId = continuationSessionId(priorSessionId, continuationPackage.segment_id);
    const fingerprint = priorEvidenceFingerprint(priorEvents, this.#artifacts.listForSession(priorSessionId));
    const binding: ContinuationBinding = {
      checkpoint_id: checkpoint.checkpoint_id,
      prior_session_id: priorSessionId,
      continuation_session_id: childSessionId,
      continuation_package_id: continuationPackage.package_id,
      continuation_hash: canonicalHash(continuationPackage),
      prior_evidence_hash: fingerprint,
    };
    const existing = this.#coach.binding(checkpoint.checkpoint_id);
    if (existing !== undefined) {
      const status = this.#coach.bind(binding);
      if (priorSession.continuation_session_id !== existing.continuation_session_id) {
        this.#sessions.write({ ...priorSession, continuation_session_id: existing.continuation_session_id });
      }
      return { status, sessionId: existing.continuation_session_id, packageId: existing.continuation_package_id };
    }
    for (const record of this.#importer.list()) {
      const imported = this.#importer.loadPackage(record.package_id);
      if (
        imported.run_id === continuationPackage.run_id
        && imported.segment_id === continuationPackage.segment_id
        && imported.package_id !== continuationPackage.package_id
      ) {
        throw new Error(`continuation segment_id is already used: ${continuationPackage.segment_id}`);
      }
    }

    this.#importer.importFromText(packageText);
    if (!this.#sessions.exists(childSessionId)) {
      const child = this.createSession(continuationPackage.package_id, childSessionId);
      this.#sessions.write({ ...child, prior_session_id: priorSessionId });
    } else {
      const child = this.#sessions.read(childSessionId);
      if (child.package_id !== continuationPackage.package_id) throw new Error("continuation session identity collision");
      if (child.state === "CREATED") {
        this.#sessions.write({ ...child, state: transitionState(child.state, "READY"), prior_session_id: priorSessionId });
      } else if (child.state !== "READY") {
        throw new Error(`continuation session is not attachable from ${child.state}`);
      }
    }
    const status = this.#coach.bind(binding);
    this.#sessions.write({ ...priorSession, continuation_session_id: childSessionId });
    return { status, sessionId: childSessionId, packageId: continuationPackage.package_id };
  }

  continuation(priorSessionId: string): ContinuationBinding {
    const prior = this.#sessions.read(priorSessionId);
    if (prior.checkpoint_id === undefined) throw new Error("session has no checkpoint");
    if (this.inspectSession(priorSessionId).status !== "AUTHORITATIVE") {
      throw new Error("prior continuation evidence is not authoritative");
    }
    const binding = this.#coach.binding(prior.checkpoint_id);
    if (binding === undefined) throw new Error("checkpoint has no continuation binding");
    const fingerprint = priorEvidenceFingerprint(this.#events.read(priorSessionId), this.#artifacts.listForSession(priorSessionId));
    if (fingerprint !== binding.prior_evidence_hash) throw new Error("prior evidence changed after continuation binding");
    return binding;
  }

  rebuildResult(sessionId: string): Document {
    const session = this.#sessions.read(sessionId);
    if (session.state !== "COMPLETED") throw new Error("only a completed session result can be rebuilt");
    const result = this.#deriveAndValidate(session);
    this.#sessions.writeResult(sessionId, result);
    return result;
  }

  getSession(sessionId: string): SessionMetadata {
    return this.#sessions.read(sessionId);
  }

  #coachProductStatus(): CoachProductStatus {
    return this.coachStatus().status as CoachProductStatus;
  }

  #currentProductSession(): SessionMetadata | undefined {
    const sessions = this.#sessions.list();
    const leaves = sessions.filter((candidate) => !sessions.some((item) => item.prior_session_id === candidate.session_id));
    const rank: Record<SessionMetadata["state"], number> = {
      QUARANTINED: 7,
      AWAITING_COACH: 6,
      RUNNING: 5,
      SUSPENDED: 4,
      READY: 3,
      CREATED: 2,
      COMPLETED: 1,
      ABORTED: 0,
    };
    return leaves.sort((left, right) => rank[right.state] - rank[left.state] || this.#sessionTimestamp(right).localeCompare(this.#sessionTimestamp(left)))[0];
  }

  #latestUnstartedPackage(): ImportRecord | undefined {
    const used = new Set(this.#sessions.list().map((session) => session.package_id));
    return this.#importer.list()
      .filter((record) => !used.has(record.package_id))
      .sort((left, right) => right.imported_at.localeCompare(left.imported_at) || right.package_id.localeCompare(left.package_id))[0];
  }

  #sessionTimestamp(session: SessionMetadata): string {
    try {
      return this.#sessions.readResult(session.session_id)?.completed_at
        ?? this.#events.read(session.session_id).at(-1)?.timestamp
        ?? this.#importer.record(session.package_id).imported_at;
    } catch {
      return this.#importer.record(session.package_id).imported_at;
    }
  }

  #append(session: SessionMetadata, packageDocument: Document, eventType: string, activityId: string | null, payload: Document): Document {
    const context: EventContext = {
      sessionId: session.session_id,
      runId: session.run_id,
      segmentId: session.segment_id,
      packageId: session.package_id,
    };
    const prior = this.#events.read(session.session_id).at(-1);
    return this.#events.append(context, packageDocument, {
      eventType,
      activityId,
      timestamp: this.#now(),
      monotonicOffsetMs: prior === undefined ? 0 : prior.monotonic_offset_ms + 1000,
      payload,
    });
  }

  #assertSupported(activity: Document): void {
    if (!["INSTRUCTION", "PRESENT_TEXT", "SELECT", "TEXT_RESPONSE"].includes(activity.type)) {
      throw new UnsupportedRuntimePrimitiveError(activity.type);
    }
  }

  #validateResponse(activity: Document, response?: { optionIds?: string[]; text?: string }): void {
    if (activity.type === "TEXT_RESPONSE") {
      if (typeof response?.text !== "string") throw new Error("TEXT_RESPONSE requires text");
      const characters = Array.from(response.text).length;
      if (characters < activity.config.min_characters || characters > activity.config.max_characters) {
        throw new Error("TEXT_RESPONSE character count is outside package bounds");
      }
      return;
    }
    if (activity.type !== "SELECT") {
      if (response !== undefined) throw new Error(`${activity.type} does not accept a response`);
      return;
    }
    const optionIds = response?.optionIds;
    if (!Array.isArray(optionIds)) throw new Error("SELECT requires optionIds");
    if (new Set(optionIds).size !== optionIds.length) throw new Error("SELECT optionIds must be unique");
    if (optionIds.length < activity.config.min_selections || optionIds.length > activity.config.max_selections) {
      throw new Error("SELECT option count is outside package bounds");
    }
    const allowed = new Set<string>(activity.config.options.map((option: Document) => option.option_id));
    if (optionIds.some((id) => !allowed.has(id))) throw new Error("SELECT contains an unknown option");
  }

  #deriveAndValidate(session: SessionMetadata): Document {
    const packageDocument = this.#importer.loadPackage(session.package_id);
    const protectedEvaluation = this.#importer.loadProtected(session.package_id);
    const events = this.#events.read(session.session_id);
    const result = deriveSessionResult(packageDocument, protectedEvaluation, events);
    this.#validator.validateResult(result, events, packageDocument, protectedEvaluation, {
      artifacts: this.#artifacts.metadataById(),
      artifactRoot: this.#artifacts.root,
    });
    return result;
  }

  #quarantine(session: SessionMetadata, reason: string): void {
    if (session.state === "QUARANTINED") return;
    this.#sessions.write({ ...session, state: transitionState(session.state, "QUARANTINED"), quarantine_reason: reason });
  }
}
