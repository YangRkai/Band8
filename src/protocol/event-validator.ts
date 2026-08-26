import { ProtocolValidationError, type EventValidationMode } from "./validator.js";

type Document = Record<string, any>;
type StreamState = "VALID_INCOMPLETE" | "COMPLETED" | "ABORTED" | "AWAITING_COACH" | "QUARANTINED";

const terminalEvents = new Set(["session_completed", "session_abandoned", "session_quarantined", "coach_checkpoint_reached"]);
const payloadContracts: Record<string, [string[], string[]]> = {
  session_started: [["run_id", "segment_id", "mode"], ["run_id", "segment_id", "mode"]],
  session_paused: [["reason"], ["reason"]], session_resumed: [["resume_operation_id"], ["resume_operation_id"]],
  session_suspended: [["reason"], ["reason"]], session_completed: [["completed_activity_ids"], ["completed_activity_ids"]],
  session_abandoned: [["reason"], ["reason"]], session_quarantined: [["reason", "invalid_record_refs"], ["reason", "invalid_record_refs"]],
  coach_checkpoint_reached: [["checkpoint_id", "required_evidence_refs"], ["checkpoint_id", "required_evidence_refs"]],
  clock_anomaly_detected: [["previous_timestamp", "current_timestamp"], ["previous_timestamp", "current_timestamp"]],
  activity_started: [["attempt_id"], ["attempt_id"]], activity_completed: [["attempt_id"], ["attempt_id"]],
  answer_selected: [["attempt_id", "option_ids"], ["attempt_id", "option_ids"]], answer_changed: [["attempt_id", "option_ids"], ["attempt_id", "option_ids"]],
  answer_submitted: [["attempt_id", "response_kind"], ["attempt_id", "response_kind", "option_ids", "text_value", "ordered_item_ids", "pairs", "output_ref"]],
  audio_started: [["resource_id", "play_number", "position_ms"], ["resource_id", "play_number", "position_ms"]],
  audio_paused: [["resource_id", "play_number", "position_ms"], ["resource_id", "play_number", "position_ms"]],
  audio_replayed: [["resource_id", "play_number", "position_ms"], ["resource_id", "play_number", "position_ms"]],
  text_revisited: [["resource_id", "visit_count"], ["resource_id", "visit_count"]],
  evidence_selected: [["attempt_id", "resource_id", "spans"], ["attempt_id", "resource_id", "spans"]],
  evidence_changed: [["attempt_id", "resource_id", "spans"], ["attempt_id", "resource_id", "spans"]],
  hint_requested: [["attempt_id", "hint_type"], ["attempt_id", "hint_type"]],
  correction_started: [["attempt_id", "revision_of", "feedback_ref", "source_output_ref"], ["attempt_id", "revision_of", "feedback_ref", "source_output_ref"]],
  correction_submitted: [["attempt_id", "revision_of", "feedback_ref", "source_output_ref"], ["attempt_id", "revision_of", "feedback_ref", "source_output_ref", "output_ref"]],
  retry_started: [["attempt_id", "revision_of"], ["attempt_id", "revision_of", "feedback_ref", "source_output_ref"]],
  retry_completed: [["attempt_id", "revision_of"], ["attempt_id", "revision_of", "feedback_ref", "source_output_ref", "output_ref"]],
  self_rating_submitted: [["attempt_id", "rating"], ["attempt_id", "rating"]],
  writing_revision_created: [["attempt_id", "artifact_id", "revision_of"], ["attempt_id", "artifact_id", "revision_of"]],
  speaking_recording_created: [["attempt_id", "artifact_id"], ["attempt_id", "artifact_id", "revision_of"]],
  artifact_created: [["artifact_id"], ["artifact_id"]], reinforcement_awarded: [["decision_id"], ["decision_id"]],
  assessment_submitted: [["activity_ids"], ["activity_ids"]], record_invalidated: [["target_record_id", "reason"], ["target_record_id", "reason"]],
  record_migrated: [["migration_record_id"], ["migration_record_id"]],
};

function fail(message: string): never { throw new ProtocolValidationError(message); }

function validatePayload(event: Document): void {
  const contract = payloadContracts[event.event_type];
  if (contract === undefined) fail("unsupported event type");
  const [required, allowed] = contract;
  const keys = Object.keys(event.payload);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => !allowed.includes(key))) fail(`${String(event.event_type)} payload is invalid`);
  if (event.event_type === "answer_submitted") {
    const fields: Record<string, string> = { selection: "option_ids", mapping: "pairs", order: "ordered_item_ids", text: "text_value", evidence_spans: "output_ref", audio: "output_ref", self_rating: "output_ref" };
    const responseField = fields[event.payload.response_kind];
    if (responseField === undefined || !(responseField in event.payload)) fail("answer_submitted payload does not match response_kind");
  }
}

export function validateEventsSemantics(events: Document[], packageDocument: Document | undefined, mode: EventValidationMode): { state: StreamState } {
  if (events.length === 0) fail("event stream is empty");
  for (const event of events) validatePayload(event);
  if (new Set(events.map((event) => event.event_id)).size !== events.length) fail("event IDs must be unique");
  if (events[0]?.event_type !== "session_started" || events[0]?.sequence_number !== 1) fail("event stream must begin with sequence 1 session_started");
  if (mode === "complete" && !terminalEvents.has(events.at(-1)?.event_type)) fail("event stream must end with a terminal session event");
  const first = events[0] as Document;
  if (packageDocument !== undefined && [first.package_id, first.run_id, first.segment_id].join("|") !== [packageDocument.package_id, packageDocument.run_id, packageDocument.segment_id].join("|")) fail("event stream context does not match package");
  const activities = new Map<string, Document>((packageDocument?.activities ?? []).map((activity: Document) => [activity.activity_id, activity]));
  const active = new Set<string>();
  const resumeOperations = new Set<string>();
  const seenEvents = new Set<string>();
  let sessionState: "RUNNING" | "SUSPENDED" | "COMPLETED" | "ABORTED" | "AWAITING_COACH" | "QUARANTINED" = "RUNNING";
  let previousOffset = -1;
  let previousTimestamp: string | undefined;
  let terminal = false;
  for (const [zeroIndex, event] of events.entries()) {
    const index = zeroIndex + 1;
    if (terminal) fail("event occurs after terminal event");
    if (event.sequence_number !== index) fail("event sequence_number is not contiguous");
    for (const field of ["session_id", "run_id", "segment_id", "package_id"]) if (event[field] !== first[field]) fail("event stream mixes context");
    if (event.monotonic_offset_ms < previousOffset) fail("event monotonic offsets move backwards");
    if (previousTimestamp !== undefined && Date.parse(event.timestamp) < Date.parse(previousTimestamp) && event.event_type !== "clock_anomaly_detected") fail("wall-clock rollback requires clock_anomaly_detected");
    if (event.event_type === "clock_anomaly_detected" && (event.payload.previous_timestamp !== previousTimestamp || event.payload.current_timestamp !== event.timestamp)) fail("clock anomaly payload is invalid");
    previousOffset = event.monotonic_offset_ms;
    previousTimestamp = event.timestamp;
    const activityId = event.activity_id as string | null;
    if (packageDocument !== undefined && activityId !== null && !activities.has(activityId)) fail("event activity_id does not resolve in package");
    if (activityId !== null && event.payload.attempt_id !== undefined && event.payload.attempt_id !== activities.get(activityId)?.attempt_id) fail("event attempt_id does not match package activity");
    if (["session_paused", "session_suspended"].includes(event.event_type)) {
      if (sessionState !== "RUNNING" || active.size > 0) fail("suspend requires quiescent running state");
      sessionState = "SUSPENDED";
    } else if (event.event_type === "session_resumed") {
      if (sessionState !== "SUSPENDED") fail("resume requires suspended state");
      const operation = event.payload.resume_operation_id as string;
      if (resumeOperations.has(operation)) fail("duplicate resume operation emitted a second event");
      resumeOperations.add(operation);
      sessionState = "RUNNING";
    } else if (event.event_type === "session_completed") {
      if (!["RUNNING", "SUSPENDED"].includes(sessionState) || active.size > 0) fail("completion requires quiescent runnable state");
      sessionState = "COMPLETED";
    } else if (event.event_type === "session_abandoned") {
      if (!["RUNNING", "SUSPENDED"].includes(sessionState)) fail("abandonment requires runnable state");
      sessionState = "ABORTED";
    } else if (event.event_type === "session_quarantined") sessionState = "QUARANTINED";
    else if (event.event_type === "coach_checkpoint_reached") sessionState = "AWAITING_COACH";
    else if (!["session_started", "clock_anomaly_detected", "record_invalidated", "record_migrated"].includes(event.event_type) && sessionState !== "RUNNING") fail("activity event requires running state");
    if (event.event_type === "activity_started") {
      if (activityId === null || active.has(activityId)) fail("activity_started has invalid state");
      active.add(activityId);
    } else if (event.event_type === "activity_completed") {
      if (activityId === null || !active.has(activityId)) fail("activity_completed precedes activity_started");
      active.delete(activityId);
    } else if (activityId !== null && !["record_invalidated", "record_migrated"].includes(event.event_type) && !active.has(activityId)) fail("activity event occurs outside active activity");
    if (event.event_type === "record_invalidated" && (event.invalidates !== event.payload.target_record_id || !seenEvents.has(event.invalidates))) fail("record invalidation target is invalid");
    seenEvents.add(event.event_id);
    terminal = terminalEvents.has(event.event_type);
  }
  if (mode === "complete" && active.size > 0) fail("terminal event leaves activities active");
  return { state: terminal ? sessionState as Exclude<StreamState, "VALID_INCOMPLETE"> : "VALID_INCOMPLETE" };
}
