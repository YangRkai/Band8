import { createHash } from "node:crypto";

type Document = Record<string, any>;

function resultId(sessionId: string, activityId: string): string {
  return `result-${createHash("sha256").update(`${sessionId}:${activityId}`, "utf8").digest("hex").slice(0, 24)}`;
}

function objectiveOutcome(submission: Document, entry: Document): "successful" | "unsuccessful" {
  if (entry.scoring_rule === "exact_option_set") {
    const actual = [...(submission.payload.option_ids ?? [])].sort();
    const expected = [...entry.correct_option_ids].sort();
    return JSON.stringify(actual) === JSON.stringify(expected) ? "successful" : "unsuccessful";
  }
  if (entry.scoring_rule === "normalized_text_set") {
    const normalize = (value: string) => value.toLocaleLowerCase("en").trim().replace(/\s+/gu, " ");
    return entry.accepted_texts.map(normalize).includes(normalize(submission.payload.text_value ?? "")) ? "successful" : "unsuccessful";
  }
  if (entry.scoring_rule === "exact_order") {
    return JSON.stringify(submission.payload.ordered_item_ids ?? []) === JSON.stringify(entry.expected_order) ? "successful" : "unsuccessful";
  }
  return JSON.stringify(submission.payload.pairs ?? []) === JSON.stringify(entry.expected_pairs) ? "successful" : "unsuccessful";
}

export function deriveSessionResult(
  packageDocument: Document,
  protectedEvaluation: Document | undefined,
  events: Document[],
): Document {
  const first = events[0];
  const terminal = events.at(-1);
  if (first === undefined || terminal === undefined || terminal.event_type !== "session_completed") {
    throw new Error("completed terminal evidence is required to derive a result");
  }
  const submissions = new Map<string, Document>();
  for (const event of events) if (event.event_type === "answer_submitted") submissions.set(event.activity_id, event);
  const objectiveResults = (protectedEvaluation?.entries ?? []).map((entry: Document) => {
    const submission = submissions.get(entry.activity_id);
    if (submission === undefined) throw new Error(`protected activity lacks submission: ${entry.activity_id}`);
    return {
      result_id: resultId(first.session_id, entry.activity_id),
      activity_id: entry.activity_id,
      performance_class: packageDocument.session_intent.evidence_class,
      outcome: objectiveOutcome(submission, entry),
      evidence_refs: [submission.event_id],
    };
  });
  const userArtifacts = events
    .filter((event) => event.event_type === "artifact_created")
    .map((event) => event.payload.artifact_id as string);
  const corrections = events
    .filter((event) => event.event_type === "writing_revision_created")
    .map((event) => event.event_id as string);
  const evidenceRefs = objectiveResults.length > 0
    ? objectiveResults.flatMap((item: Document) => item.evidence_refs)
    : userArtifacts.length > 0 ? userArtifacts : [terminal.event_id];
  return {
    schema_version: "0.1.0",
    protocol_version: "0.1.0",
    session_id: first.session_id,
    run_id: first.run_id,
    segment_id: first.segment_id,
    package_id: first.package_id,
    started_at: first.timestamp,
    completed_at: terminal.timestamp,
    effective_duration_seconds: Math.floor((terminal.monotonic_offset_ms - first.monotonic_offset_ms) / 1000),
    activities_completed: terminal.payload.completed_activity_ids,
    objective_results: objectiveResults,
    user_artifacts: userArtifacts,
    corrections,
    retries: [],
    self_assessments: [],
    abandonment: null,
    reinforcement_events: [],
    evidence_refs: evidenceRefs,
    source_event_ids: events.map((event) => event.event_id),
  };
}
