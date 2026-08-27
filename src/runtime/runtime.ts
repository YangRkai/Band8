import { randomUUID } from "node:crypto";

import { canonicalHash, parseJsonStrict } from "../protocol/canonical.js";
import { createProtocolValidator, type ProtocolValidator } from "../protocol/validator.js";
import { ArtifactStore } from "../storage/artifact-store.js";
import { CheckpointStore } from "../storage/checkpoint-store.js";
import { CoachExchange, type ContinuationBinding } from "../storage/coach-exchange.js";
import { AppendOnlyEventStore, type EventContext } from "../storage/event-store.js";
import { PackageImporter } from "../storage/package-importer.js";
import { ReinforcementStore } from "../storage/reinforcement-store.js";
import {
  LearningTimezoneStore,
  type LearningTimezoneEpoch,
  type LearningTimezoneSettings,
} from "../storage/learning-timezone-store.js";
import { SessionStore, type SessionMetadata } from "../storage/session-store.js";
import { initializeWorkspace } from "../storage/workspace.js";
import { continuationSessionId, priorEvidenceFingerprint } from "./continuation.js";
import { ReinforcementEngine } from "../reinforcement/engine.js";
import { projectReveal } from "../reinforcement/reveal.js";
import { projectLearnerActivity } from "./projection.js";
import { deriveSessionResult } from "./result.js";
import { transitionState } from "./state-machine.js";

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
  readonly #learningTimezone: LearningTimezoneStore;
  readonly #now: () => string;
  readonly #artifactIdFactory: () => string;

  private constructor(options: RuntimeOptions) {
    const workspace = initializeWorkspace(options.workspacePath);
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
