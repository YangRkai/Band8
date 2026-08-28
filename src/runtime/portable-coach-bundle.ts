import { createHash } from "node:crypto";

import { canonicalHash, parseJsonStrict } from "../protocol/canonical.js";
import type { CoachExportResponse } from "../product-api/dto.js";

type JsonObject = { [key: string]: unknown };

function object(value: unknown, name: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${name} must be an object`);
  return value as JsonObject;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be a string`);
  return value;
}

function nonEmptyString(value: unknown, name: string): string {
  const result = string(value, name);
  if (result.length === 0) throw new Error(`${name} must not be empty`);
  return result;
}

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw new Error(`${name} must be a string array`);
  return [...value] as string[];
}

function exactKeys(value: JsonObject, expected: readonly string[], name: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${name} has an open or incomplete field set`);
}

function rejectForbiddenKeys(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectForbiddenKeys(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (["relative_path", "manifest_ref", "correct_option_ids", "scoring_rule", "protected_evaluation", "protectedEvaluation", "band8-session"].includes(key)) {
      throw new Error(`portable Coach bundle contains forbidden field: ${key}`);
    }
    rejectForbiddenKeys(child);
  }
}

export function validatePortableCoachBundle(value: unknown): CoachExportResponse {
  rejectForbiddenKeys(value);
  const envelope = object(value, "portable Coach bundle");
  exactKeys(envelope, ["schema_version", "api_version", "bundle_type", "trust_classification", "checkpoint_id", "coach_bundle", "checkpoint_manifest", "records"], "portable Coach bundle");
  if (
    string(envelope.schema_version, "schema_version") !== "0.1.0"
    || string(envelope.api_version, "api_version") !== "v1"
    || string(envelope.bundle_type, "bundle_type") !== "band8_coach_download"
    || string(envelope.trust_classification, "trust_classification") !== "DATA_ONLY"
  ) throw new Error("portable Coach bundle identity is invalid");

  const coach = object(envelope.coach_bundle, "coach_bundle");
  exactKeys(coach, ["bundle_type", "checkpoint_id", "protocol_version", "schema_version", "trust_classification", "trust_contract", "relevant_activity_refs", "contract_versions"], "coach_bundle");
  if (string(coach.bundle_type, "coach bundle_type") !== "band8_coach_input" || string(coach.trust_classification, "coach trust_classification") !== "DATA_ONLY") {
    throw new Error("portable Coach input trust identity is invalid");
  }
  const checkpointId = string(envelope.checkpoint_id, "checkpoint_id");
  if (string(coach.checkpoint_id, "coach checkpoint_id") !== checkpointId) throw new Error("portable Coach checkpoint identity mismatch");
  const coachProtocolVersion = nonEmptyString(coach.protocol_version, "coach protocol_version");
  const coachSchemaVersion = nonEmptyString(coach.schema_version, "coach schema_version");
  nonEmptyString(coach.trust_contract, "coach trust_contract");
  strings(coach.relevant_activity_refs, "relevant_activity_refs");
  const versions = object(coach.contract_versions, "contract_versions");
  if (Object.keys(versions).length === 0 || Object.values(versions).some((item) => typeof item !== "string" || item.length === 0)) {
    throw new Error("portable Coach contract versions are invalid");
  }

  const manifest = object(envelope.checkpoint_manifest, "checkpoint_manifest");
  exactKeys(manifest, ["checkpoint_id", "checkpoint_reason", "created_at", "package_hash", "package_id", "protocol_version", "required_evidence_refs", "run_id", "schema_version", "segment_id", "session_id", "status"], "checkpoint_manifest");
  if (string(manifest.checkpoint_id, "manifest checkpoint_id") !== checkpointId) throw new Error("portable Coach manifest checkpoint mismatch");
  nonEmptyString(manifest.checkpoint_reason, "manifest checkpoint_reason");
  const createdAt = nonEmptyString(manifest.created_at, "manifest created_at");
  if (!Number.isFinite(Date.parse(createdAt))) throw new Error("portable Coach manifest created_at is invalid");
  const manifestPackageHash = nonEmptyString(manifest.package_hash, "manifest package_hash");
  const packageId = nonEmptyString(manifest.package_id, "manifest package_id");
  const manifestProtocolVersion = nonEmptyString(manifest.protocol_version, "manifest protocol_version");
  const manifestSchemaVersion = nonEmptyString(manifest.schema_version, "manifest schema_version");
  const manifestRunId = nonEmptyString(manifest.run_id, "manifest run_id");
  const manifestSegmentId = nonEmptyString(manifest.segment_id, "manifest segment_id");
  const manifestSessionId = nonEmptyString(manifest.session_id, "manifest session_id");
  nonEmptyString(manifest.status, "manifest status");
  if (manifestProtocolVersion !== coachProtocolVersion || manifestSchemaVersion !== coachSchemaVersion) {
    throw new Error("portable Coach protocol/schema identity mismatch");
  }
  const requiredEvidence = strings(manifest.required_evidence_refs, "required_evidence_refs");

  if (!Array.isArray(envelope.records) || envelope.records.length === 0) throw new Error("portable Coach records are required");
  const recordIds = new Set<string>();
  const resolvableEvidence = new Set<string>();
  const trainingPackages: Array<{ recordId: string; contentHash: string; document: JsonObject }> = [];
  let eventStreamCount = 0;
  for (const valueRecord of envelope.records) {
    const record = object(valueRecord, "portable Coach record");
    exactKeys(record, ["record_id", "record_kind", "protocol_version", "producer", "trust_classification", "content_hash", "media_type", "content"], "portable Coach record");
    const recordId = string(record.record_id, "record_id");
    if (recordIds.has(recordId)) throw new Error("portable Coach record identity collision");
    recordIds.add(recordId);
    const kind = string(record.record_kind, "record_kind");
    if (!["training_package", "raw_event_stream", "learner_artifact"].includes(kind)) throw new Error("portable Coach record kind is invalid");
    if (string(record.trust_classification, "record trust_classification") !== "data") throw new Error("portable Coach record is not DATA-only");
    const recordProtocolVersion = nonEmptyString(record.protocol_version, "record protocol_version");
    if (recordProtocolVersion !== manifestProtocolVersion) throw new Error(`portable Coach record protocol mismatch: ${recordId}`);
    nonEmptyString(record.producer, "record producer");
    const mediaType = nonEmptyString(record.media_type, "record media_type");
    const content = string(record.content, "record content");
    const expectedHash = nonEmptyString(record.content_hash, "record content_hash");
    const actualHash = kind === "training_package"
      ? canonicalHash(parseJsonStrict(content))
      : `sha256:${createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex")}`;
    if (actualHash !== expectedHash) throw new Error(`portable Coach record hash mismatch: ${recordId}`);
    if (kind === "training_package") {
      if (mediaType !== "application/json") throw new Error("portable Coach training package media_type mismatch");
      const parsed = object(parseJsonStrict(content), "portable training package");
      trainingPackages.push({ recordId, contentHash: expectedHash, document: parsed });
    } else if (kind === "raw_event_stream") {
      if (mediaType !== "application/x-ndjson") throw new Error("portable Coach event stream media_type mismatch");
      eventStreamCount += 1;
      if (recordId !== `events-${manifestSessionId}`) throw new Error("portable Coach event stream session identity mismatch");
      const lines = content.split(/\r?\n/u).filter((line) => line.length > 0);
      if (lines.length === 0) throw new Error("portable Coach event stream is empty");
      for (const line of lines) {
        const event = object(parseJsonStrict(line), "portable event");
        const eventId = nonEmptyString(event.event_id, "portable event_id");
        if (
          nonEmptyString(event.session_id, "portable event session_id") !== manifestSessionId
          || nonEmptyString(event.run_id, "portable event run_id") !== manifestRunId
          || nonEmptyString(event.segment_id, "portable event segment_id") !== manifestSegmentId
          || nonEmptyString(event.package_id, "portable event package_id") !== packageId
        ) throw new Error("portable Coach event stream identity mismatch");
        resolvableEvidence.add(eventId);
      }
    } else {
      if (mediaType !== "text/plain; charset=utf-8") throw new Error("portable Coach learner artifact media_type mismatch");
    }
    resolvableEvidence.add(recordId);
  }
  if (trainingPackages.length !== 1) throw new Error("portable Coach must contain exactly one training package record");
  if (eventStreamCount !== 1) throw new Error("portable Coach must contain exactly one event stream record");
  const trainingContext = trainingPackages[0];
  if (trainingContext === undefined) throw new Error("portable Coach package context does not resolve");
  const { recordId: packageRecordId, contentHash: packageRecordHash, document: trainingPackage } = trainingContext;
  if (packageRecordId !== packageId || nonEmptyString(trainingPackage.package_id, "portable package_id") !== packageId) {
    throw new Error("portable Coach package identity mismatch");
  }
  if (manifestPackageHash !== packageRecordHash) throw new Error("portable Coach manifest package hash mismatch");
  if (nonEmptyString(trainingPackage.run_id, "portable package run_id") !== manifestRunId) throw new Error("portable Coach package run identity mismatch");
  if (nonEmptyString(trainingPackage.segment_id, "portable package segment_id") !== manifestSegmentId) throw new Error("portable Coach package segment identity mismatch");
  if (nonEmptyString(trainingPackage.protocol_version, "portable package protocol_version") !== manifestProtocolVersion) {
    throw new Error("portable Coach package protocol identity mismatch");
  }
  for (const evidenceRef of requiredEvidence) {
    if (!resolvableEvidence.has(evidenceRef)) throw new Error(`portable Coach evidence reference does not resolve: ${evidenceRef}`);
  }
  const activityIds = new Set(
    (Array.isArray(trainingPackage.activities) ? trainingPackage.activities : [])
      .map((activity) => string(object(activity, "portable activity").activity_id, "portable activity_id")),
  );
  for (const activityRef of strings(coach.relevant_activity_refs, "relevant_activity_refs")) {
    if (!activityIds.has(activityRef)) throw new Error(`portable Coach activity reference does not resolve: ${activityRef}`);
  }
  return value as CoachExportResponse;
}
