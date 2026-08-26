import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import canonicalize from "canonicalize";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../../../..");
const base = JSON.parse(readFileSync(resolve(root, "tests/protocol/fixtures/valid/minimal-training-package.json"), "utf8"));
const sha256 = (value) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
const canonicalHash = (value) => sha256(canonicalize(value));
const clone = (value) => structuredClone(value);
const passage = "At Brookfield Library, a trial replaced printed reminder slips with optional email notices. Borrowers could still request paper notices at the desk. After three months, late returns fell, but the library did not measure whether email users read more books.";

const packageDocument = clone(base);
packageDocument.package_id = "pkg-runtime-reading-001";
packageDocument.run_id = "run-runtime-reading-001";
packageDocument.segment_id = "segment-runtime-reading-001";
packageDocument.created_at = "2026-08-26T14:00:00Z";
packageDocument.generator = { producer: "band8-synthetic-fixture", producer_version: "0.1.0" };
packageDocument.session_intent = { mode: "training", objective: "Distinguish stated facts from unsupported claims in a synthetic reading passage.", evidence_class: "training_performance" };
packageDocument.training_rationale = { summary: "A generated, source-safe vertical slice for deterministic Runtime execution.", evidence_refs: [] };
packageDocument.target_skills = ["reading.explicit-detail", "reading.not-given"];
packageDocument.resources = [{
  resource_id: "resource-runtime-passage", resource_type: "text", content_format: "plain_text", content: passage,
  provenance: { origin_type: "generated", source_identifier: null, generator: { producer: "band8-synthetic-fixture", producer_version: "0.1.0" }, content_hash: sha256(passage), license: null, attribution: null, redistribution_status: "cleared" },
}];

function common(activityId, attemptId, type, prompt) {
  const activity = clone(base.activities[0]);
  Object.assign(activity, { activity_id: activityId, attempt_id: attemptId, type, phase_id: "phase-runtime-reading", prompt, skill_refs: ["reading.explicit-detail"] });
  activity.relationships = { revision_of: null, feedback_ref: null, source_output_ref: null, prior_evidence_refs: [] };
  activity.feedback = { timing: "none", allowed: [] };
  activity.completion = { required: true, submit_required: type === "SELECT" };
  activity.evidence_requirements = ["activity_started", "activity_completed"];
  return activity;
}

const instruction = common("activity-runtime-instruction", "attempt-runtime-instruction", "INSTRUCTION", "Read the passage, then answer both statements using only stated information.");
instruction.resource_refs = [];
instruction.config = { acknowledge_required: true };
instruction.output_contract = { kind: "none", artifact_type: null };
const present = common("activity-runtime-passage", "attempt-runtime-passage", "PRESENT_TEXT", "Read the synthetic library passage.");
present.resource_refs = ["resource-runtime-passage"];
present.config = { display_mode: "continuous" };
present.output_contract = { kind: "none", artifact_type: null };

function select(activityId, attemptId, prompt) {
  const activity = common(activityId, attemptId, "SELECT", prompt);
  activity.resource_refs = ["resource-runtime-passage"];
  activity.config = { selection_mode: "one", options: [{ option_id: "true", label: "True" }, { option_id: "false", label: "False" }, { option_id: "not-given", label: "Not Given" }], min_selections: 1, max_selections: 1 };
  activity.output_contract = { kind: "selection", artifact_type: null };
  activity.evidence_requirements = ["activity_started", "answer_selected", "answer_submitted", "activity_completed"];
  return activity;
}

const first = select("activity-runtime-select-1", "attempt-runtime-select-1", "Late returns fell during the email-notice trial.");
const second = select("activity-runtime-select-2", "attempt-runtime-select-2", "Email notices caused borrowers to read more books.");
packageDocument.phases = [{ phase_id: "phase-runtime-reading", kind: "practice", activity_ids: [instruction.activity_id, present.activity_id, first.activity_id, second.activity_id] }];
packageDocument.activities = [instruction, present, first, second];
packageDocument.completion_policy = { required_activity_ids: packageDocument.phases[0].activity_ids, allow_partial_result: false, coach_checkpoint: null };
packageDocument.feedback_policy = { mode: "training", allow_hints: false, allow_retry: false, correction_timing: "none" };
packageDocument.evidence_requirements = { required_event_types: ["session_started", "activity_started", "activity_completed", "answer_selected", "answer_submitted", "session_completed"], artifact_types: [] };

const entries = [
  { activity_id: first.activity_id, scoring_rule: "exact_option_set", correct_option_ids: ["true"], accepted_texts: [], expected_order: [], expected_pairs: [] },
  { activity_id: second.activity_id, scoring_rule: "exact_option_set", correct_option_ids: ["not-given"], accepted_texts: [], expected_order: [], expected_pairs: [] },
].map((entry) => ({ ...entry, integrity_ref: canonicalHash(entry) }));
const evaluation = { schema_version: "0.1.0", protocol_version: "0.1.0", evaluation_id: "evaluation-runtime-reading-001", package_id: packageDocument.package_id, package_hash: "", content_hash: canonicalHash(entries), entries };
packageDocument.protected_evaluation_ref = { evaluation_id: evaluation.evaluation_id, content_hash: evaluation.content_hash };
evaluation.package_hash = canonicalHash(packageDocument);
writeFileSync(resolve(directory, "training-package.json"), `${JSON.stringify(packageDocument, null, 2)}\n`, "utf8");
writeFileSync(resolve(directory, "protected-evaluation.json"), `${JSON.stringify(evaluation, null, 2)}\n`, "utf8");
