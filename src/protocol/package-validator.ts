import { createHash } from "node:crypto";

import { canonicalHash } from "./canonical.js";
import { ProtocolValidationError } from "./validator.js";

type Document = Record<string, any>;

const primitives = new Set([
  "INSTRUCTION",
  "PRESENT_TEXT",
  "PLAY_AUDIO",
  "SELECT",
  "MATCH",
  "ORDER",
  "TEXT_RESPONSE",
  "EVIDENCE_SELECT",
  "SPEAK_RECORD",
  "SELF_ASSESS",
]);

const eventTypes = new Set([
  "session_started", "session_paused", "session_resumed", "session_suspended", "session_completed",
  "session_abandoned", "session_quarantined", "coach_checkpoint_reached", "clock_anomaly_detected",
  "activity_started", "activity_completed", "answer_selected", "answer_changed", "answer_submitted",
  "audio_started", "audio_paused", "audio_replayed", "text_revisited", "evidence_selected",
  "evidence_changed", "hint_requested", "correction_started", "correction_submitted", "retry_started",
  "retry_completed", "self_rating_submitted", "writing_revision_created", "speaking_recording_created",
  "artifact_created", "reinforcement_awarded", "assessment_submitted", "record_invalidated", "record_migrated",
]);

function fail(message: string): never {
  throw new ProtocolValidationError(message);
}

function uniqueIds(items: Document[], key: string, label: string): Set<string> {
  const values = items.map((item) => item[key] as string);
  if (values.some((value) => typeof value !== "string") || new Set(values).size !== values.length) {
    fail(`${label} contains duplicate or missing IDs`);
  }
  return new Set(values);
}

function requireConfig(activity: Document, required: string[], allowed = required): Document {
  const config = activity.config as Document;
  const keys = Object.keys(config);
  const missing = required.filter((key) => !(key in config));
  const unknown = keys.filter((key) => !allowed.includes(key));
  if (missing.length > 0 || unknown.length > 0) {
    fail(`${String(activity.activity_id)} has invalid primitive config`);
  }
  return config;
}

function validatePrimitive(activity: Document): void {
  const primitive = activity.type as string;
  if (!primitives.has(primitive)) fail(`unknown primitive: ${primitive}`);
  const contracts: Record<string, [string[], string[], string]> = {
    INSTRUCTION: [["acknowledge_required"], ["acknowledge_required"], "none"],
    PRESENT_TEXT: [["display_mode"], ["display_mode"], "none"],
    PLAY_AUDIO: [["max_plays", "allow_seek"], ["max_plays", "allow_seek"], "none"],
    SELECT: [["selection_mode", "options", "min_selections", "max_selections"], ["selection_mode", "options", "min_selections", "max_selections"], "selection"],
    MATCH: [["left_items", "right_items"], ["left_items", "right_items"], "mapping"],
    ORDER: [["items"], ["items"], "order"],
    TEXT_RESPONSE: [["response_kind", "min_characters", "max_characters"], ["response_kind", "min_characters", "max_characters", "artifact_type"], "text"],
    EVIDENCE_SELECT: [["min_spans", "max_spans", "allow_revision", "preserve_raw_selection", "artifact_type"], ["min_spans", "max_spans", "allow_revision", "preserve_raw_selection", "artifact_type"], "evidence_spans"],
    SPEAK_RECORD: [["min_seconds", "max_seconds", "max_takes", "artifact_type"], ["min_seconds", "max_seconds", "max_takes", "artifact_type"], "audio"],
    SELF_ASSESS: [["scale_min", "scale_max", "labels"], ["scale_min", "scale_max", "labels"], "self_rating"],
  };
  const contract = contracts[primitive];
  if (contract === undefined) fail(`unknown primitive: ${primitive}`);
  const [required, allowed, outputKind] = contract;
  const config = requireConfig(activity, required, allowed);
  if (activity.output_contract.kind !== outputKind) fail(`${primitive} output contract is invalid`);
  if ((config.artifact_type ?? null) !== activity.output_contract.artifact_type) {
    fail(`${primitive} artifact output does not match config`);
  }
  if (primitive === "SELECT") {
    const options = config.options as Document[];
    if (!Array.isArray(options) || options.length < 2 || options.length > 20) fail("SELECT options are invalid");
    uniqueIds(options, "option_id", "SELECT options");
    if (options.some((option) => Object.keys(option).sort().join(",") !== "label,option_id")) fail("SELECT option has unsupported fields");
    const minimum = config.min_selections as number;
    const maximum = config.max_selections as number;
    if (!(Number.isInteger(minimum) && Number.isInteger(maximum) && minimum >= 1 && minimum <= maximum && maximum <= options.length)) fail("SELECT cardinality is invalid");
    if (config.selection_mode === "one" && (minimum !== 1 || maximum !== 1)) fail("single SELECT requires cardinality one");
    if (!new Set(["one", "multiple"]).has(config.selection_mode)) fail("SELECT selection_mode is invalid");
  }
}

function validateResource(resource: Document): void {
  const provenance = resource.provenance as Document;
  const actual = `sha256:${createHash("sha256").update(String(resource.content), "utf8").digest("hex")}`;
  if (provenance.content_hash !== actual) fail(`${String(resource.resource_id)}: resource content hash mismatch`);
  const origin = provenance.origin_type;
  if (origin === "generated" && provenance.generator === null) fail("generated resource requires generator provenance");
  if (origin !== "generated" && provenance.generator !== null) fail("only generated resources may name a generator");
  if (["user_provided", "licensed", "public_domain"].includes(origin) && !provenance.source_identifier) fail(`${String(origin)} resource requires source_identifier`);
  if (origin === "licensed" && (!provenance.license || !provenance.attribution)) fail("licensed resource requires license and attribution");
  if (origin === "unknown" && provenance.redistribution_status !== "not_cleared") fail("unknown provenance cannot be cleared");
}

export function validatePackageSemantics(document: Document, seenPackages?: ReadonlyMap<string, string>): { identity: "accepted" | "idempotent" } {
  const packageId = document.package_id as string;
  const hash = canonicalHash(document);
  const prior = seenPackages?.get(packageId);
  if (prior !== undefined && prior !== hash) fail(`package_id collision with different content: ${packageId}`);
  const resources = uniqueIds(document.resources, "resource_id", "resources");
  const phases = uniqueIds(document.phases, "phase_id", "phases");
  const activities = uniqueIds(document.activities, "activity_id", "activities");
  uniqueIds(document.activities, "attempt_id", "activity attempts");
  const ordered = document.phases.flatMap((phase: Document) => phase.activity_ids as string[]);
  if (ordered.length !== new Set(ordered).size || ordered.length !== activities.size || ordered.some((id: string) => !activities.has(id))) fail("phase activity references must cover each activity exactly once");
  for (const resource of document.resources as Document[]) validateResource(resource);
  const available = new Set<string>((document.available_evidence_refs ?? []) as string[]);
  for (const activity of document.activities as Document[]) {
    if (!phases.has(activity.phase_id)) fail("activity phase reference does not resolve");
    if ((activity.resource_refs as string[]).some((id) => !resources.has(id))) fail("activity resource reference does not resolve");
    const accessibilityRef = activity.accessibility.transcript_resource_ref;
    if (accessibilityRef !== undefined && !resources.has(accessibilityRef)) fail("accessibility transcript reference does not resolve");
    const relationships = activity.relationships as Document;
    if (relationships.feedback_ref !== null && !resources.has(relationships.feedback_ref)) fail("activity feedback_ref does not resolve");
    if (relationships.source_output_ref !== null && !available.has(relationships.source_output_ref)) fail("activity source_output_ref is unavailable");
    if ((relationships.prior_evidence_refs as string[]).some((id) => !available.has(id))) fail("activity prior evidence is unavailable");
    if (relationships.revision_of === activity.attempt_id) fail("activity cannot revise its own attempt");
    validatePrimitive(activity);
    if ((activity.evidence_requirements as string[]).some((type) => !eventTypes.has(type))) fail("activity requires unsupported event type");
  }
  if ((document.completion_policy.required_activity_ids as string[]).some((id) => !activities.has(id))) fail("completion policy references unknown activity");
  if ((document.training_rationale.evidence_refs as string[]).some((id) => !available.has(id))) fail("invalid evidence ref in training rationale");
  const requiredEvents = new Set<string>(document.evidence_requirements.required_event_types);
  if ([...requiredEvents].some((type) => !eventTypes.has(type))) fail("package requires unsupported event type");
  const checkpoint = document.completion_policy.coach_checkpoint;
  if (checkpoint === null && !["session_completed", "session_abandoned"].some((type) => requiredEvents.has(type))) fail("non-checkpoint package requires terminal event");
  if (checkpoint !== null && !requiredEvents.has("coach_checkpoint_reached")) fail("checkpoint package requires checkpoint event");
  const mode = document.session_intent.mode;
  if (document.feedback_policy.mode !== mode) fail("session and feedback modes differ");
  if (mode === "assessment") {
    const policy = document.feedback_policy;
    if (policy.allow_hints || policy.allow_retry || !["after_session", "none"].includes(policy.correction_timing)) fail("assessment policy exposes feedback");
    for (const activity of document.activities as Document[]) {
      if (!["none", "after_session"].includes(activity.feedback.timing) || activity.feedback.allowed.includes("retry_invitation")) fail("assessment activity exposes feedback");
    }
    if (document.protected_evaluation_ref === null) fail("assessment package requires protected evaluation");
  }
  return { identity: prior === hash ? "idempotent" : "accepted" };
}

export function validateProtectedSemantics(document: Document, packageDocument: Document): void {
  if (document.package_id !== packageDocument.package_id) fail("protected evaluation package ID mismatch");
  if (document.package_hash !== canonicalHash(packageDocument)) fail("protected evaluation package hash mismatch");
  if (document.content_hash !== canonicalHash(document.entries)) fail("protected evaluation content hash mismatch");
  const reference = packageDocument.protected_evaluation_ref;
  if (reference === null || reference.evaluation_id !== document.evaluation_id || reference.content_hash !== document.content_hash) fail("protected evaluation reference mismatch");
  const activities = new Set<string>((packageDocument.activities as Document[]).map((item) => item.activity_id));
  const ruleFields: Record<string, string> = { exact_option_set: "correct_option_ids", normalized_text_set: "accepted_texts", exact_order: "expected_order", exact_pairs: "expected_pairs" };
  for (const entry of document.entries as Document[]) {
    if (!activities.has(entry.activity_id)) fail("protected evaluation activity does not resolve");
    const selected = ruleFields[entry.scoring_rule];
    for (const field of Object.values(ruleFields)) {
      const hasValues = Array.isArray(entry[field]) && entry[field].length > 0;
      if ((field === selected) !== hasValues) fail("protected evaluation scoring data is inconsistent");
    }
    const { integrity_ref: _ignored, ...payload } = entry;
    if (entry.integrity_ref !== canonicalHash(payload)) fail("protected evaluation entry integrity mismatch");
  }
}
