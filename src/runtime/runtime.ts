import { randomUUID } from "node:crypto";

import { createProtocolValidator, type ProtocolValidator } from "../protocol/validator.js";
import { AppendOnlyEventStore, type EventContext } from "../storage/event-store.js";
import { PackageImporter } from "../storage/package-importer.js";
import { SessionStore, type SessionMetadata } from "../storage/session-store.js";
import { initializeWorkspace } from "../storage/workspace.js";
import { projectLearnerActivity } from "./projection.js";
import { deriveSessionResult } from "./result.js";
import { transitionState } from "./state-machine.js";

type Document = Record<string, any>;

export interface RuntimeOptions {
  repositoryRoot: string;
  workspacePath: string;
  eventIdFactory?: () => string;
  now?: () => string;
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
  readonly #events: AppendOnlyEventStore;
  readonly #now: () => string;

  private constructor(options: RuntimeOptions) {
    const workspace = initializeWorkspace(options.workspacePath);
    this.#validator = createProtocolValidator(options.repositoryRoot);
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#importer = new PackageImporter(workspace, this.#validator, this.#now);
    this.#sessions = new SessionStore(workspace);
    this.#events = new AppendOnlyEventStore(
      workspace,
      this.#validator,
      options.eventIdFactory ?? (() => `event-${randomUUID()}`),
    );
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

  completeCurrentActivity(sessionId: string, response?: { optionIds?: string[] }): { state: SessionMetadata["state"]; result?: Document } {
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
      const verdict = this.#validator.validateEventStream(events, {
        packageDocument,
        mode: session.state === "COMPLETED" || session.state === "ABORTED" ? "complete" : "prefix",
      });
      if (verdict.state === "VALID_INCOMPLETE") return { status: "VALID_INCOMPLETE" };
      const result = this.#sessions.readResult(sessionId);
      if (result === undefined) return { status: "REBUILD_REQUIRED" };
      const protectedEvaluation = this.#importer.loadProtected(session.package_id);
      if (protectedEvaluation === undefined) throw new Error("protected evaluation is unavailable for result validation");
      this.#validator.validateResult(result, events, packageDocument, protectedEvaluation);
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
    this.#validator.validateEventStream(events, { packageDocument, mode: "prefix" });
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
    if (!["INSTRUCTION", "PRESENT_TEXT", "SELECT"].includes(activity.type)) {
      throw new UnsupportedRuntimePrimitiveError(activity.type);
    }
  }

  #validateResponse(activity: Document, response?: { optionIds?: string[] }): void {
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
    if (protectedEvaluation === undefined) throw new Error("protected evaluation is required for objective result derivation");
    const events = this.#events.read(session.session_id);
    const result = deriveSessionResult(packageDocument, protectedEvaluation, events);
    this.#validator.validateResult(result, events, packageDocument, protectedEvaluation);
    return result;
  }

  #quarantine(session: SessionMetadata, reason: string): void {
    if (session.state === "QUARANTINED") return;
    this.#sessions.write({ ...session, state: transitionState(session.state, "QUARANTINED"), quarantine_reason: reason });
  }
}
