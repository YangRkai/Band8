from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

import rfc8785


ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = ROOT / "protocol" / "schemas"
PROTOCOL_VERSION = "0.1.0"
MAX_DOCUMENT_BYTES = 1024 * 1024
MAX_DEPTH = 16
MAX_TEXT_LENGTH = 12000
MAX_SAFE_INTEGER = 9_007_199_254_740_991
PRIMITIVES = {
    "INSTRUCTION", "PRESENT_TEXT", "PLAY_AUDIO", "SELECT", "MATCH", "ORDER",
    "TEXT_RESPONSE", "EVIDENCE_SELECT", "SPEAK_RECORD", "SELF_ASSESS",
}
SCHEMAS = {
    "package": "training-package.schema.json",
    "events": "session-event.schema.json",
    "result": "session-result.schema.json",
    "artifact": "artifact-metadata.schema.json",
    "learner-state": "learner-state.schema.json",
    "hypothesis": "hypothesis.schema.json",
    "review-queue": "review-queue.schema.json",
    "checkpoint": "checkpoint.schema.json",
    "protected-evaluation": "protected-evaluation.schema.json",
    "reinforcement-decision": "reinforcement-decision.schema.json",
    "migration-record": "migration-record.schema.json",
}
TERMINAL_EVENT_TYPES = {
    "session_completed", "session_abandoned", "session_quarantined",
    "coach_checkpoint_reached",
}


class ValidationError(ValueError):
    pass


def canonical_json_bytes(document: Any) -> bytes:
    try:
        return rfc8785.dumps(document)
    except rfc8785.CanonicalizationError as exc:
        raise ValidationError(f"RFC 8785 canonicalization failed: {exc}") from exc


def canonical_document_hash(document: Any) -> str:
    return "sha256:" + hashlib.sha256(canonical_json_bytes(document)).hexdigest()


def text_content_hash(value: str) -> str:
    return "sha256:" + hashlib.sha256(value.encode("utf-8")).hexdigest()


def classify_package_identity(
    document: dict[str, Any], seen_packages: dict[str, str] | None = None
) -> str:
    package_id = document["package_id"]
    current_hash = canonical_document_hash(document)
    prior_hash = (seen_packages or {}).get(package_id)
    if prior_hash is None:
        return "accepted"
    if prior_hash == current_hash:
        return "idempotent"
    raise ValidationError(f"package_id collision with different content: {package_id}")


def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    document: dict[str, Any] = {}
    for key, value in pairs:
        if key in document:
            raise ValidationError(f"duplicate JSON object property: {key}")
        document[key] = value
    return document


def reject_non_finite_number(value: str) -> None:
    raise ValidationError(f"non-finite JSON number is forbidden: {value}")


def strict_json_loads(value: str) -> Any:
    return json.loads(
        value,
        object_pairs_hook=reject_duplicate_keys,
        parse_constant=reject_non_finite_number,
    )


def load_json(path: Path, max_bytes: int = MAX_DOCUMENT_BYTES) -> Any:
    try:
        if path.stat().st_size > max_bytes:
            raise ValidationError(f"document exceeds {max_bytes} bytes")
        return strict_json_loads(path.read_text(encoding="utf-8"))
    except ValidationError:
        raise
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"cannot load JSON: {exc}") from exc


def load_ndjson(path: Path) -> list[Any]:
    try:
        if path.stat().st_size > MAX_DOCUMENT_BYTES:
            raise ValidationError(f"document exceeds {MAX_DOCUMENT_BYTES} bytes")
        documents = []
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip():
                continue
            try:
                documents.append(strict_json_loads(line))
            except json.JSONDecodeError as exc:
                raise ValidationError(f"line {number} is malformed JSON: {exc.msg}") from exc
        if not documents:
            raise ValidationError("event stream is empty")
        return documents
    except ValidationError:
        raise
    except OSError as exc:
        raise ValidationError(f"cannot load NDJSON: {exc}") from exc


def resolve_ref(root: dict[str, Any], reference: str) -> dict[str, Any]:
    if not reference.startswith("#/"):
        raise ValidationError(f"external schema reference is forbidden: {reference}")
    node: Any = root
    for token in reference[2:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if not isinstance(node, dict) or token not in node:
            raise ValidationError(f"unresolved schema reference: {reference}")
        node = node[token]
    if not isinstance(node, dict):
        raise ValidationError(f"schema reference is not an object: {reference}")
    return node


def type_matches(value: Any, expected: str) -> bool:
    mapping = {
        "object": lambda item: isinstance(item, dict),
        "array": lambda item: isinstance(item, list),
        "string": lambda item: isinstance(item, str),
        "integer": lambda item: isinstance(item, int) and not isinstance(item, bool),
        "number": lambda item: isinstance(item, (int, float)) and not isinstance(item, bool),
        "boolean": lambda item: isinstance(item, bool),
        "null": lambda item: item is None,
    }
    return expected in mapping and mapping[expected](value)


def validate_schema(instance: Any, schema: dict[str, Any], root: dict[str, Any], path: str = "$") -> None:
    if "$ref" in schema:
        validate_schema(instance, resolve_ref(root, schema["$ref"]), root, path)
        return
    if "const" in schema and instance != schema["const"]:
        raise ValidationError(f"{path}: expected constant {schema['const']!r}")
    if "enum" in schema and instance not in schema["enum"]:
        raise ValidationError(f"{path}: value is not in the allowed enumeration")
    if "type" in schema:
        expected = schema["type"] if isinstance(schema["type"], list) else [schema["type"]]
        if not any(type_matches(instance, item) for item in expected):
            raise ValidationError(f"{path}: expected type {' or '.join(expected)}")
    if isinstance(instance, dict):
        required = schema.get("required", [])
        missing = [key for key in required if key not in instance]
        if missing:
            raise ValidationError(f"{path}: missing required fields: {', '.join(missing)}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            unknown = sorted(set(instance) - set(properties))
            if unknown:
                raise ValidationError(f"{path}: unsupported fields: {', '.join(unknown)}")
        if "maxProperties" in schema and len(instance) > schema["maxProperties"]:
            raise ValidationError(f"{path}: too many object properties")
        for key, value in instance.items():
            if key in properties:
                validate_schema(value, properties[key], root, f"{path}.{key}")
    if isinstance(instance, list):
        if len(instance) < schema.get("minItems", 0):
            raise ValidationError(f"{path}: too few array items")
        if "maxItems" in schema and len(instance) > schema["maxItems"]:
            raise ValidationError(f"{path}: too many array items")
        if schema.get("uniqueItems"):
            encoded = [json.dumps(item, sort_keys=True, ensure_ascii=False) for item in instance]
            if len(encoded) != len(set(encoded)):
                raise ValidationError(f"{path}: array items must be unique")
        if "items" in schema:
            for index, item in enumerate(instance):
                validate_schema(item, schema["items"], root, f"{path}[{index}]")
    if isinstance(instance, str):
        if len(instance) < schema.get("minLength", 0):
            raise ValidationError(f"{path}: string is too short")
        if "maxLength" in schema and len(instance) > schema["maxLength"]:
            raise ValidationError(f"{path}: string is too long")
        if "pattern" in schema and re.fullmatch(schema["pattern"], instance) is None:
            raise ValidationError(f"{path}: string does not match required pattern")
        if schema.get("format") == "date-time":
            try:
                datetime.fromisoformat(instance.replace("Z", "+00:00"))
            except ValueError as exc:
                raise ValidationError(f"{path}: invalid RFC 3339 date-time") from exc
    if isinstance(instance, (int, float)) and not isinstance(instance, bool):
        if isinstance(instance, int) and not -MAX_SAFE_INTEGER <= instance <= MAX_SAFE_INTEGER:
            raise ValidationError(f"{path}: integer is outside the JavaScript safe integer range")
        if isinstance(instance, float) and not math.isfinite(instance):
            raise ValidationError(f"{path}: non-finite number is forbidden")
        if "minimum" in schema and instance < schema["minimum"]:
            raise ValidationError(f"{path}: number is below minimum")
        if "maximum" in schema and instance > schema["maximum"]:
            raise ValidationError(f"{path}: number is above maximum")


def validate_against_schema(document: Any, schema_name: str) -> None:
    schema = load_json(SCHEMA_DIR / schema_name)
    if not isinstance(schema, dict):
        raise ValidationError("schema must be an object")
    validate_schema(document, schema, schema)


def walk_values(value: Any, depth: int = 0) -> Iterable[str]:
    if depth > MAX_DEPTH:
        raise ValidationError(f"JSON nesting exceeds {MAX_DEPTH}")
    if isinstance(value, str):
        if len(value) > MAX_TEXT_LENGTH:
            raise ValidationError(f"text field exceeds {MAX_TEXT_LENGTH} characters")
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from walk_values(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            yield from walk_values(item, depth + 1)


def unique_ids(items: list[dict[str, Any]], key: str, label: str) -> set[str]:
    values = [item.get(key) for item in items]
    if any(not isinstance(value, str) or not value for value in values):
        raise ValidationError(f"{label} contains missing ID")
    if len(values) != len(set(values)):
        raise ValidationError(f"{label} contains duplicate IDs")
    return set(values)


def require_config(activity: dict[str, Any], required: set[str], allowed: set[str]) -> dict[str, Any]:
    config = activity.get("config")
    if not isinstance(config, dict):
        raise ValidationError(f"{activity.get('activity_id', 'activity')}: malformed activity config")
    missing = sorted(required - set(config))
    unknown = sorted(set(config) - allowed)
    if missing:
        raise ValidationError(f"{activity['activity_id']}: missing config fields: {', '.join(missing)}")
    if unknown:
        raise ValidationError(f"{activity['activity_id']}: unsupported config fields: {', '.join(unknown)}")
    return config


def validate_primitive(activity: dict[str, Any], activity_ids: set[str]) -> None:
    primitive = activity["type"]
    if primitive not in PRIMITIVES:
        raise ValidationError(f"unknown primitive: {primitive}")
    contracts = {
        "INSTRUCTION": ({"acknowledge_required"}, {"acknowledge_required"}),
        "PRESENT_TEXT": ({"display_mode"}, {"display_mode"}),
        "PLAY_AUDIO": ({"max_plays", "allow_seek"}, {"max_plays", "allow_seek"}),
        "SELECT": ({"selection_mode", "options", "min_selections", "max_selections"}, {"selection_mode", "options", "min_selections", "max_selections"}),
        "MATCH": ({"left_items", "right_items"}, {"left_items", "right_items"}),
        "ORDER": ({"items"}, {"items"}),
        "TEXT_RESPONSE": ({"response_kind", "min_characters", "max_characters"}, {"response_kind", "min_characters", "max_characters", "artifact_type"}),
        "EVIDENCE_SELECT": ({"min_spans", "max_spans", "allow_revision", "preserve_raw_selection", "artifact_type"}, {"min_spans", "max_spans", "allow_revision", "preserve_raw_selection", "artifact_type"}),
        "SPEAK_RECORD": ({"min_seconds", "max_seconds", "max_takes", "artifact_type"}, {"min_seconds", "max_seconds", "max_takes", "artifact_type"}),
        "SELF_ASSESS": ({"scale_min", "scale_max", "labels"}, {"scale_min", "scale_max", "labels"}),
    }
    required, allowed = contracts[primitive]
    config = require_config(activity, required, allowed)
    if primitive == "SELECT":
        options = config["options"]
        if not isinstance(options, list) or not 2 <= len(options) <= 20:
            raise ValidationError("SELECT options must contain 2 to 20 items")
        option_ids = unique_ids(options, "option_id", "SELECT options")
        if any(set(option) != {"option_id", "label"} for option in options):
            raise ValidationError("SELECT option has unsupported fields")
        minimum, maximum = config["min_selections"], config["max_selections"]
        if not isinstance(minimum, int) or not isinstance(maximum, int) or not (1 <= minimum <= maximum <= len(option_ids)):
            raise ValidationError("SELECT cardinality is invalid")
        if config["selection_mode"] not in {"one", "multiple"}:
            raise ValidationError("SELECT selection_mode is invalid")
        if config["selection_mode"] == "one" and (minimum != 1 or maximum != 1):
            raise ValidationError("single SELECT requires cardinality one")
    elif primitive in {"MATCH", "ORDER"}:
        for key in ("items",) if primitive == "ORDER" else ("left_items", "right_items"):
            if not isinstance(config[key], list) or not 2 <= len(config[key]) <= 30:
                raise ValidationError(f"{primitive} {key} is invalid")
            if any(
                not isinstance(item, dict)
                or set(item) != {"item_id", "label"}
                or not isinstance(item["item_id"], str)
                or not isinstance(item["label"], str)
                for item in config[key]
            ):
                raise ValidationError(f"{primitive} {key} items are malformed")
            unique_ids(config[key], "item_id", f"{primitive} {key}")
    elif primitive == "TEXT_RESPONSE":
        if config["response_kind"] not in {"short", "long", "explanation", "recall"}:
            raise ValidationError("TEXT_RESPONSE response_kind is invalid")
        if not 1 <= config["min_characters"] <= config["max_characters"] <= MAX_TEXT_LENGTH:
            raise ValidationError("TEXT_RESPONSE character bounds are invalid")
        if "artifact_type" in config and config["artifact_type"] not in {
            "essay", "rewrite", "long_form_answer"
        }:
            raise ValidationError("TEXT_RESPONSE artifact_type is invalid")
    elif primitive == "EVIDENCE_SELECT":
        if (
            not 0 <= config["min_spans"] <= config["max_spans"] <= 20
            or config["preserve_raw_selection"] is not True
            or config["artifact_type"] != "highlighted_evidence"
        ):
            raise ValidationError("EVIDENCE_SELECT span or preservation contract is invalid")
    elif primitive == "SPEAK_RECORD":
        if not 1 <= config["min_seconds"] <= config["max_seconds"] <= 1800 or not 1 <= config["max_takes"] <= 5 or config["artifact_type"] != "speaking_audio":
            raise ValidationError("SPEAK_RECORD bounds are invalid")
    elif primitive == "SELF_ASSESS":
        if not 0 <= config["scale_min"] < config["scale_max"] <= 10:
            raise ValidationError("SELF_ASSESS scale is invalid")
        if (
            not isinstance(config["labels"], list)
            or not all(isinstance(label, str) and label for label in config["labels"])
            or len(config["labels"]) != config["scale_max"] - config["scale_min"] + 1
        ):
            raise ValidationError("SELF_ASSESS labels do not cover the scale")
    elif primitive == "PLAY_AUDIO":
        if not 1 <= config["max_plays"] <= 5 or not isinstance(config["allow_seek"], bool):
            raise ValidationError("PLAY_AUDIO config is invalid")
    elif primitive == "PRESENT_TEXT" and config["display_mode"] not in {"continuous", "paged"}:
        raise ValidationError("PRESENT_TEXT display_mode is invalid")
    elif primitive == "INSTRUCTION" and not isinstance(config["acknowledge_required"], bool):
        raise ValidationError("INSTRUCTION acknowledgement is invalid")
    output_kind = activity["output_contract"]["kind"]
    expected_outputs = {
        "INSTRUCTION": "none",
        "PRESENT_TEXT": "none",
        "PLAY_AUDIO": "none",
        "SELECT": "selection",
        "MATCH": "mapping",
        "ORDER": "order",
        "TEXT_RESPONSE": "text",
        "EVIDENCE_SELECT": "evidence_spans",
        "SPEAK_RECORD": "audio",
        "SELF_ASSESS": "self_rating",
    }
    if output_kind != expected_outputs[primitive]:
        raise ValidationError(f"{primitive} output contract is invalid")
    artifact_type = activity["output_contract"]["artifact_type"]
    config_artifact = config.get("artifact_type")
    if config_artifact != artifact_type:
        if not (config_artifact is None and artifact_type is None):
            raise ValidationError(f"{primitive} artifact output does not match config")


def validate_provenance(resource: dict[str, Any]) -> None:
    provenance = resource["provenance"]
    if provenance["content_hash"] != text_content_hash(resource["content"]):
        raise ValidationError(f"{resource['resource_id']}: resource content hash mismatch")
    origin = provenance["origin_type"]
    if origin == "generated" and provenance["generator"] is None:
        raise ValidationError("generated resource requires generator provenance")
    if origin != "generated" and provenance["generator"] is not None:
        raise ValidationError("only generated resources may name a generator")
    if origin == "user_provided" and not provenance["source_identifier"]:
        raise ValidationError("user_provided resource requires local source_identifier")
    if origin in {"licensed", "public_domain"} and not provenance["source_identifier"]:
        raise ValidationError(f"{origin} resource requires source_identifier")
    if origin == "licensed" and (not provenance["license"] or not provenance["attribution"]):
        raise ValidationError("licensed resource requires license and attribution")
    if origin == "unknown" and provenance["redistribution_status"] != "not_cleared":
        raise ValidationError("unknown provenance cannot be redistribution-cleared")


def validate_package(
    document: Any, seen_packages: dict[str, str] | None = None
) -> str:
    validate_against_schema(document, SCHEMAS["package"])
    identity = classify_package_identity(document, seen_packages)
    resources = unique_ids(document["resources"], "resource_id", "resources")
    phases = unique_ids(document["phases"], "phase_id", "phases")
    activities = unique_ids(document["activities"], "activity_id", "activities")
    ordered: list[str] = []
    for phase in document["phases"]:
        ordered.extend(phase["activity_ids"])
    if len(ordered) != len(set(ordered)) or set(ordered) != activities:
        raise ValidationError("phase activity references must cover each activity exactly once")
    for resource in document["resources"]:
        validate_provenance(resource)
    attempt_ids = unique_ids(document["activities"], "attempt_id", "activity attempts")
    available = set(document.get("available_evidence_refs", []))
    for activity in document["activities"]:
        if activity["phase_id"] not in phases:
            raise ValidationError("activity phase reference does not resolve")
        if not set(activity["resource_refs"]).issubset(resources):
            raise ValidationError("activity resource reference does not resolve")
        transcript = activity["accessibility"].get("transcript_resource_ref")
        if transcript is not None and transcript not in resources:
            raise ValidationError("accessibility transcript reference does not resolve")
        relationships = activity["relationships"]
        feedback_ref = relationships["feedback_ref"]
        if feedback_ref is not None and feedback_ref not in resources:
            raise ValidationError("activity feedback_ref does not resolve to package data")
        source_output_ref = relationships["source_output_ref"]
        if source_output_ref is not None and source_output_ref not in available:
            raise ValidationError("activity source_output_ref is unavailable")
        if not set(relationships["prior_evidence_refs"]).issubset(available):
            raise ValidationError("activity prior_evidence_refs are unavailable")
        if relationships["revision_of"] == activity["attempt_id"]:
            raise ValidationError("activity cannot revise its own attempt")
        validate_primitive(activity, activities)
    if not set(document["completion_policy"]["required_activity_ids"]).issubset(activities):
        raise ValidationError("completion policy references unknown activity")
    if not set(document["training_rationale"]["evidence_refs"]).issubset(available):
        raise ValidationError("invalid evidence ref in training rationale")
    required_event_types = set(document["evidence_requirements"]["required_event_types"])
    if not required_event_types.issubset(EVENT_PAYLOAD_CONTRACTS):
        raise ValidationError("package requires unsupported event type")
    for activity in document["activities"]:
        if not set(activity["evidence_requirements"]).issubset(EVENT_PAYLOAD_CONTRACTS):
            raise ValidationError("activity requires unsupported event type")
    checkpoint = document["completion_policy"]["coach_checkpoint"]
    if checkpoint is not None and not set(checkpoint["source_activity_ids"]).issubset(activities):
        raise ValidationError("coach checkpoint references unknown activity")
    if checkpoint is not None and "coach_checkpoint_reached" not in required_event_types:
        raise ValidationError("checkpoint package must require coach_checkpoint_reached")
    if checkpoint is None and not required_event_types.intersection({"session_completed", "session_abandoned"}):
        raise ValidationError("non-checkpoint package must require a terminal session event")
    continuation = document["continuation"]
    if continuation is not None:
        if continuation["prior_segment_id"] == document["segment_id"]:
            raise ValidationError("continuation must advance to a new segment")
        if not set(continuation["required_evidence_refs"]).issubset(available):
            raise ValidationError("continuation evidence is unavailable")
    mode = document["session_intent"]["mode"]
    if document["feedback_policy"]["mode"] != mode:
        raise ValidationError("session and feedback modes differ")
    if mode == "assessment":
        policy = document["feedback_policy"]
        if policy["allow_hints"] or policy["allow_retry"] or policy["correction_timing"] not in {"after_session", "none"}:
            raise ValidationError("assessment mode forbids hints, retry, and in-session correction")
        for activity in document["activities"]:
            if activity["feedback"]["timing"] not in {"none", "after_session"} or "retry_invitation" in activity["feedback"]["allowed"]:
                raise ValidationError("assessment activity exposes in-performance feedback")
        if document["protected_evaluation_ref"] is None:
            raise ValidationError("assessment package requires protected evaluation")
    if any("correctness" in activity["feedback"]["allowed"] for activity in document["activities"]):
        if document["protected_evaluation_ref"] is None:
            raise ValidationError("deterministic correctness feedback requires protected evaluation")
    if any(activity["pedagogical_intent"] == "assessment" for activity in document["activities"]) and mode != "assessment":
        raise ValidationError("assessment intent requires assessment mode")
    return identity


EVENT_PAYLOAD_CONTRACTS: dict[str, tuple[set[str], set[str]]] = {
    "session_started": ({"run_id", "segment_id", "mode"}, {"run_id", "segment_id", "mode"}),
    "session_paused": ({"reason"}, {"reason"}),
    "session_resumed": ({"resume_operation_id"}, {"resume_operation_id"}),
    "session_suspended": ({"reason"}, {"reason"}),
    "session_completed": ({"completed_activity_ids"}, {"completed_activity_ids"}),
    "session_abandoned": ({"reason"}, {"reason"}),
    "session_quarantined": ({"reason", "invalid_record_refs"}, {"reason", "invalid_record_refs"}),
    "coach_checkpoint_reached": ({"checkpoint_id", "required_evidence_refs"}, {"checkpoint_id", "required_evidence_refs"}),
    "clock_anomaly_detected": ({"previous_timestamp", "current_timestamp"}, {"previous_timestamp", "current_timestamp"}),
    "activity_started": ({"attempt_id"}, {"attempt_id"}),
    "activity_completed": ({"attempt_id"}, {"attempt_id"}),
    "answer_selected": ({"attempt_id", "option_ids"}, {"attempt_id", "option_ids"}),
    "answer_changed": ({"attempt_id", "option_ids"}, {"attempt_id", "option_ids"}),
    "answer_submitted": ({"attempt_id", "response_kind"}, {"attempt_id", "response_kind", "option_ids", "text_value", "ordered_item_ids", "pairs", "output_ref"}),
    "audio_started": ({"resource_id", "play_number", "position_ms"}, {"resource_id", "play_number", "position_ms"}),
    "audio_paused": ({"resource_id", "play_number", "position_ms"}, {"resource_id", "play_number", "position_ms"}),
    "audio_replayed": ({"resource_id", "play_number", "position_ms"}, {"resource_id", "play_number", "position_ms"}),
    "text_revisited": ({"resource_id", "visit_count"}, {"resource_id", "visit_count"}),
    "evidence_selected": ({"attempt_id", "resource_id", "spans"}, {"attempt_id", "resource_id", "spans"}),
    "evidence_changed": ({"attempt_id", "resource_id", "spans"}, {"attempt_id", "resource_id", "spans"}),
    "hint_requested": ({"attempt_id", "hint_type"}, {"attempt_id", "hint_type"}),
    "correction_started": ({"attempt_id", "revision_of", "feedback_ref", "source_output_ref"}, {"attempt_id", "revision_of", "feedback_ref", "source_output_ref"}),
    "correction_submitted": ({"attempt_id", "revision_of", "feedback_ref", "source_output_ref"}, {"attempt_id", "revision_of", "feedback_ref", "source_output_ref", "output_ref"}),
    "retry_started": ({"attempt_id", "revision_of"}, {"attempt_id", "revision_of", "feedback_ref", "source_output_ref"}),
    "retry_completed": ({"attempt_id", "revision_of"}, {"attempt_id", "revision_of", "feedback_ref", "source_output_ref", "output_ref"}),
    "self_rating_submitted": ({"attempt_id", "rating"}, {"attempt_id", "rating"}),
    "writing_revision_created": ({"attempt_id", "artifact_id", "revision_of"}, {"attempt_id", "artifact_id", "revision_of"}),
    "speaking_recording_created": ({"attempt_id", "artifact_id"}, {"attempt_id", "artifact_id", "revision_of"}),
    "artifact_created": ({"artifact_id"}, {"artifact_id"}),
    "reinforcement_awarded": ({"decision_id"}, {"decision_id"}),
    "assessment_submitted": ({"activity_ids"}, {"activity_ids"}),
    "record_invalidated": ({"target_record_id", "reason"}, {"target_record_id", "reason"}),
    "record_migrated": ({"migration_record_id"}, {"migration_record_id"}),
}


def validate_event_payload(event: dict[str, Any]) -> None:
    required, allowed = EVENT_PAYLOAD_CONTRACTS[event["event_type"]]
    payload = event["payload"]
    missing = required - set(payload)
    unknown = set(payload) - allowed
    if missing:
        raise ValidationError(
            f"{event['event_type']} payload missing: {', '.join(sorted(missing))}"
        )
    if unknown:
        raise ValidationError(
            f"{event['event_type']} payload unsupported: {', '.join(sorted(unknown))}"
        )
    if event["event_type"] == "answer_submitted":
        response_fields = {
            "selection": "option_ids", "mapping": "pairs", "order": "ordered_item_ids",
            "text": "text_value", "evidence_spans": "output_ref", "audio": "output_ref",
            "self_rating": "output_ref",
        }
        expected = response_fields[payload["response_kind"]]
        if expected not in payload:
            raise ValidationError("answer_submitted payload does not match response_kind")


def validate_events(
    events: list[Any],
    *,
    package: dict[str, Any] | None = None,
    artifacts: dict[str, dict[str, Any]] | None = None,
    artifact_root: Path | None = None,
    mode: str = "complete",
) -> None:
    if mode not in {"prefix", "complete"}:
        raise ValidationError("event validation mode must be prefix or complete")
    for event in events:
        validate_against_schema(event, SCHEMAS["events"])
        list(walk_values(event))
        validate_event_payload(event)
    ids = [event["event_id"] for event in events]
    if len(ids) != len(set(ids)):
        raise ValidationError("event IDs must be unique")
    if events[0]["event_type"] != "session_started" or events[0]["sequence_number"] != 1:
        raise ValidationError("event stream must begin with sequence 1 session_started")
    if mode == "complete" and events[-1]["event_type"] not in TERMINAL_EVENT_TYPES:
        raise ValidationError("event stream must end with a terminal session event")
    session_id = events[0]["session_id"]
    run_id = events[0]["run_id"]
    segment_id = events[0]["segment_id"]
    package_id = events[0]["package_id"]
    if package is not None:
        validate_package(package)
        if (package_id, run_id, segment_id) != (
            package["package_id"], package["run_id"], package["segment_id"]
        ):
            raise ValidationError("event stream context does not match package")
        package_activities = {item["activity_id"]: item for item in package["activities"]}
    else:
        package_activities = {}
    previous_offset = -1
    previous_time: datetime | None = None
    active: set[str] = set()
    resume_operations: set[str] = set()
    terminal_seen = False
    state = "RUNNING"
    seen_event_ids: set[str] = set()
    for index, event in enumerate(events, 1):
        if terminal_seen:
            raise ValidationError("event occurs after terminal event")
        if event["sequence_number"] != index:
            raise ValidationError("event sequence_number is not contiguous")
        if (
            event["session_id"] != session_id
            or event["run_id"] != run_id
            or event["segment_id"] != segment_id
            or event["package_id"] != package_id
        ):
            raise ValidationError("event stream mixes session, run, segment, or package IDs")
        if event.get("invalidates") is not None and event["event_type"] != "record_invalidated":
            raise ValidationError("invalidates is restricted to record_invalidated")
        if event.get("supersedes") is not None and event["event_type"] != "record_migrated":
            raise ValidationError("supersedes is restricted to record_migrated")
        if event.get("migration_version") is not None and event["event_type"] != "record_migrated":
            raise ValidationError("migration_version is restricted to record_migrated")
        if event["monotonic_offset_ms"] < previous_offset:
            raise ValidationError("event monotonic offsets move backwards")
        timestamp = datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00"))
        if (
            previous_time is not None
            and timestamp < previous_time
            and event["event_type"] != "clock_anomaly_detected"
        ):
            raise ValidationError("wall-clock rollback requires clock_anomaly_detected")
        if event["event_type"] == "session_started" and (
            event["payload"]["run_id"], event["payload"]["segment_id"]
        ) != (run_id, segment_id):
            raise ValidationError("session_started payload context mismatch")
        if event["event_type"] == "clock_anomaly_detected" and previous_time is not None:
            prior = datetime.fromisoformat(event["payload"]["previous_timestamp"].replace("Z", "+00:00"))
            current = datetime.fromisoformat(event["payload"]["current_timestamp"].replace("Z", "+00:00"))
            if prior != previous_time or current != timestamp:
                raise ValidationError("clock anomaly payload does not describe the observed rollback")
        previous_offset, previous_time = event["monotonic_offset_ms"], timestamp
        activity_id = event["activity_id"]
        if package is not None and activity_id is not None and activity_id not in package_activities:
            raise ValidationError("event activity_id does not resolve in package")
        if activity_id is not None and "attempt_id" in event["payload"] and package is not None:
            if event["payload"]["attempt_id"] != package_activities[activity_id]["attempt_id"]:
                raise ValidationError("event attempt_id does not match package activity")
        if index > 1 and event["event_type"] == "session_started":
            raise ValidationError("session_started may occur only at sequence 1")
        if event["event_type"] in {"session_paused", "session_suspended"}:
            if state != "RUNNING" or active:
                raise ValidationError("suspend requires running state with no active activity")
            state = "SUSPENDED"
        elif event["event_type"] == "session_resumed":
            if state != "SUSPENDED":
                raise ValidationError("resume requires suspended state")
            state = "RUNNING"
        elif event["event_type"] == "coach_checkpoint_reached":
            if state != "RUNNING" or active:
                raise ValidationError("Coach checkpoint requires quiescent running state")
            if package is not None:
                configured = package["completion_policy"]["coach_checkpoint"]
                if configured is None or event["payload"]["checkpoint_id"] != configured["checkpoint_id"]:
                    raise ValidationError("Coach checkpoint event does not match package")
            state = "AWAITING_COACH"
        elif event["event_type"] == "session_completed":
            if state not in {"RUNNING", "SUSPENDED"} or active:
                raise ValidationError("completion requires quiescent runnable state")
            state = "COMPLETED"
        elif event["event_type"] == "session_abandoned":
            if state not in {"RUNNING", "SUSPENDED"}:
                raise ValidationError("abandonment requires active or suspended state")
            state = "ABORTED"
        elif event["event_type"] == "session_quarantined":
            state = "QUARANTINED"
        elif event["event_type"] not in {
            "session_started", "clock_anomaly_detected", "record_invalidated", "record_migrated"
        } and event["event_type"] not in TERMINAL_EVENT_TYPES and state != "RUNNING":
            raise ValidationError("activity or evidence event requires running state")
        if event["event_type"] == "activity_started":
            if activity_id is None or activity_id in active:
                raise ValidationError("activity_started has invalid activity state")
            active.add(activity_id)
        elif event["event_type"] == "activity_completed":
            if activity_id not in active:
                raise ValidationError("activity_completed precedes activity_started")
            active.remove(activity_id)
        elif activity_id is not None and event["event_type"] not in {"record_invalidated", "record_migrated"} and activity_id not in active:
            raise ValidationError("activity event occurs outside an active activity")
        if event["event_type"] == "session_resumed":
            operation_id = event["payload"]["resume_operation_id"]
            if operation_id in resume_operations:
                raise ValidationError("duplicate resume operation emitted a second event")
            resume_operations.add(operation_id)
        if event["event_type"] == "record_invalidated" and event.get("invalidates") != event["payload"]["target_record_id"]:
            raise ValidationError("record_invalidated must bind its target")
        if event["event_type"] == "record_invalidated" and event["payload"]["target_record_id"] not in seen_event_ids:
            raise ValidationError("record_invalidated target must resolve to earlier evidence")
        if event["event_type"] == "record_migrated":
            if not event.get("migration_version") or not event.get("supersedes"):
                raise ValidationError("record_migrated requires supersedes and migration_version")
            if event["supersedes"] not in seen_event_ids:
                raise ValidationError("record_migrated source must resolve to earlier evidence")
        if event["event_type"] == "artifact_created" and artifacts is not None:
            artifact_id = event["payload"]["artifact_id"]
            if artifact_id not in artifacts:
                raise ValidationError("artifact event references missing metadata")
            metadata = artifacts[artifact_id]
            validate_document("artifact", metadata)
            if metadata["source_activity_id"] != activity_id:
                raise ValidationError("artifact source activity does not match event")
            if (
                metadata["session_id"], metadata["run_id"], metadata["segment_id"], metadata["package_id"]
            ) != (session_id, run_id, segment_id, package_id):
                raise ValidationError("artifact metadata context does not match event stream")
            if artifact_root is not None:
                artifact_path = artifact_root / metadata["relative_path"]
                try:
                    content = artifact_path.read_bytes()
                except OSError as exc:
                    raise ValidationError("artifact bytes are missing") from exc
                actual_hash = "sha256:" + hashlib.sha256(content).hexdigest()
                if actual_hash != metadata["content_hash"]:
                    raise ValidationError("artifact content hash mismatch")
        terminal_seen = event["event_type"] in TERMINAL_EVENT_TYPES
        seen_event_ids.add(event["event_id"])
    if mode == "complete" and active:
        raise ValidationError("terminal event leaves activities active")


def safe_relative_path(value: str) -> bool:
    if "\\" in value or re.match(r"^[A-Za-z]:", value) or value.startswith(("/", "//")) or "://" in value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts and all(part not in {"", "."} for part in path.parts)


def validate_document(kind: str, document: Any) -> None:
    validate_against_schema(document, SCHEMAS[kind])
    list(walk_values(document))
    if kind == "artifact" and not safe_relative_path(document["relative_path"]):
        raise ValidationError("artifact relative_path is unsafe")
    if kind == "hypothesis" and set(document["supporting_evidence"]) & set(document["contradicting_evidence"]):
        raise ValidationError("hypothesis evidence cannot be both supporting and contradicting")


def validate_checkpoint(document: Any, package: dict[str, Any]) -> None:
    validate_document("checkpoint", document)
    validate_package(package)
    configured = package["completion_policy"]["coach_checkpoint"]
    if configured is None:
        raise ValidationError("package does not declare a Coach checkpoint")
    if document["package_hash"] != canonical_document_hash(package):
        raise ValidationError("checkpoint package hash mismatch")
    expected = (
        configured["checkpoint_id"],
        configured["checkpoint_reason"],
        package["package_id"],
        package["run_id"],
        package["segment_id"],
    )
    actual = (
        document["checkpoint_id"],
        document["checkpoint_reason"],
        document["package_id"],
        document["run_id"],
        document["segment_id"],
    )
    if actual != expected:
        raise ValidationError("checkpoint does not match package orchestration")


def validate_continuation(
    continuation_package: dict[str, Any],
    prior_package: dict[str, Any],
    checkpoint: dict[str, Any],
) -> None:
    validate_package(prior_package)
    validate_checkpoint(checkpoint, prior_package)
    validate_package(continuation_package)
    binding = continuation_package["continuation"]
    if binding is None:
        raise ValidationError("continuation package lacks continuation binding")
    if continuation_package["run_id"] != prior_package["run_id"]:
        raise ValidationError("continuation must preserve run_id")
    if continuation_package["segment_id"] == prior_package["segment_id"]:
        raise ValidationError("continuation must advance segment_id")
    expected = (
        prior_package["package_id"], prior_package["segment_id"], checkpoint["checkpoint_id"]
    )
    actual = (
        binding["continuation_of"], binding["prior_segment_id"], binding["checkpoint_id"]
    )
    if actual != expected:
        raise ValidationError("continuation binding does not match checkpoint")
    if set(binding["required_evidence_refs"]) != set(checkpoint["required_evidence_refs"]):
        raise ValidationError("continuation must consume the checkpoint evidence set")
    prior_attempts = {item["attempt_id"] for item in prior_package["activities"]}
    current_attempts = {item["attempt_id"] for item in continuation_package["activities"]}
    for activity in continuation_package["activities"]:
        revision_of = activity["relationships"]["revision_of"]
        if revision_of is not None and revision_of not in prior_attempts | current_attempts:
            raise ValidationError("continuation revision_of does not resolve")


def validate_protected_evaluation(document: Any, package: dict[str, Any]) -> None:
    validate_document("protected-evaluation", document)
    validate_package(package)
    reference = package["protected_evaluation_ref"]
    if reference is None:
        raise ValidationError("package does not declare protected evaluation")
    if document["package_id"] != package["package_id"]:
        raise ValidationError("protected evaluation package ID mismatch")
    if document["package_hash"] != canonical_document_hash(package):
        raise ValidationError("protected evaluation package hash mismatch")
    if document["content_hash"] != canonical_document_hash(document["entries"]):
        raise ValidationError("protected evaluation content hash mismatch")
    if (reference["evaluation_id"], reference["content_hash"]) != (
        document["evaluation_id"], document["content_hash"]
    ):
        raise ValidationError("protected evaluation reference mismatch")
    activities = {item["activity_id"]: item for item in package["activities"]}
    for entry in document["entries"]:
        if entry["activity_id"] not in activities:
            raise ValidationError("protected evaluation activity does not resolve")
        rule_fields = {
            "exact_option_set": "correct_option_ids",
            "normalized_text_set": "accepted_texts",
            "exact_order": "expected_order",
            "exact_pairs": "expected_pairs",
        }
        selected = rule_fields[entry["scoring_rule"]]
        for field in rule_fields.values():
            if field == selected and not entry[field]:
                raise ValidationError("protected evaluation scoring data is missing")
            if field != selected and entry[field]:
                raise ValidationError("protected evaluation contains unrelated scoring data")
        integrity_payload = {key: value for key, value in entry.items() if key != "integrity_ref"}
        if entry["integrity_ref"] != canonical_document_hash(integrity_payload):
            raise ValidationError("protected evaluation entry integrity mismatch")


def validate_session_result(
    result: dict[str, Any],
    events: list[Any],
    package: dict[str, Any],
    protected_evaluation: dict[str, Any],
) -> None:
    validate_document("result", result)
    validate_package(package)
    validate_protected_evaluation(protected_evaluation, package)
    validate_events(events, package=package, mode="complete")
    context = (
        result["session_id"], result["run_id"], result["segment_id"], result["package_id"]
    )
    expected_context = (
        events[0]["session_id"], package["run_id"], package["segment_id"], package["package_id"]
    )
    if context != expected_context:
        raise ValidationError("session result context does not match evidence")
    event_ids = {event["event_id"] for event in events}
    artifact_ids = {
        event["payload"]["artifact_id"]
        for event in events
        if event["event_type"] == "artifact_created"
    }
    if set(result["source_event_ids"]) != event_ids:
        raise ValidationError("session result does not cite the complete event stream")
    if not set(result["evidence_refs"]).issubset(event_ids | artifact_ids):
        raise ValidationError("session result evidence reference does not resolve")
    terminal_completed = set(events[-1]["payload"].get("completed_activity_ids", []))
    if set(result["activities_completed"]) != terminal_completed:
        raise ValidationError("session result completion does not match terminal evidence")
    submissions = {
        event["activity_id"]: event
        for event in events
        if event["event_type"] == "answer_submitted"
    }
    entries = {entry["activity_id"]: entry for entry in protected_evaluation["entries"]}
    objective_results = {item["activity_id"]: item for item in result["objective_results"]}
    if set(objective_results) != set(entries):
        raise ValidationError("objective results do not cover protected evaluation entries")
    for activity_id, entry in entries.items():
        if activity_id not in submissions:
            raise ValidationError("objective result lacks submitted response evidence")
        payload = submissions[activity_id]["payload"]
        rule = entry["scoring_rule"]
        if rule == "exact_option_set":
            successful = set(payload.get("option_ids", [])) == set(entry["correct_option_ids"])
        elif rule == "normalized_text_set":
            value = " ".join(payload.get("text_value", "").casefold().split())
            successful = value in {" ".join(item.casefold().split()) for item in entry["accepted_texts"]}
        elif rule == "exact_order":
            successful = payload.get("ordered_item_ids", []) == entry["expected_order"]
        else:
            successful = payload.get("pairs", []) == entry["expected_pairs"]
        expected_outcome = "successful" if successful else "unsuccessful"
        item = objective_results[activity_id]
        if item["outcome"] != expected_outcome:
            raise ValidationError("objective result outcome is not derived from protected evidence")
        if item["performance_class"] != package["session_intent"]["evidence_class"]:
            raise ValidationError("objective result performance class differs from package intent")
        if submissions[activity_id]["event_id"] not in item["evidence_refs"]:
            raise ValidationError("objective result does not cite its submission")


def validate_reinforcement_decision(
    document: Any, evidence_ids: set[str] | None = None
) -> None:
    validate_document("reinforcement-decision", document)
    if document["reward_type"] != "pattern_broken":
        raise ValidationError("V0.1 defines deterministic eligibility only for pattern_broken")
    chain = document["evidence_chain"]
    if document["decision_type"] == "historical_award":
        if document["qualification"] != "confirmed" or document["supersedes"] is not None:
            raise ValidationError("historical award must be an original confirmed decision")
        weakness = chain["recurring_weakness"]
        if (
            len(weakness) < 2
            or len({item["session_id"] for item in weakness}) < 2
            or any(item["outcome"] != "unsuccessful" for item in weakness)
        ):
            raise ValidationError("PATTERN_BROKEN requires weakness in two earlier sessions")
        intervention = chain["targeted_intervention"]
        if intervention is None:
            raise ValidationError("PATTERN_BROKEN requires a targeted intervention")
        improvement = chain["repeated_improvement"]
        if len(improvement) < 2 or any(item["outcome"] != "successful" for item in improvement):
            raise ValidationError("PATTERN_BROKEN requires two successful improvements")
        delayed = chain["delayed_retrieval"]
        if delayed is None or delayed["outcome"] != "successful" or delayed["delay_seconds"] < 86400:
            raise ValidationError("PATTERN_BROKEN requires successful retrieval after 24 hours")
        transfer = chain["transfer"]
        if (
            transfer is None
            or transfer["outcome"] != "successful"
            or transfer["source_resource_hash"] == transfer["transfer_resource_hash"]
        ):
            raise ValidationError("PATTERN_BROKEN requires successful changed-material transfer")
        if chain["unresolved_contradictory_assessment_refs"]:
            raise ValidationError("unresolved assessment contradiction blocks PATTERN_BROKEN")
        if chain["regression_evidence_refs"]:
            raise ValidationError("historical award cannot contain later regression evidence")
    else:
        if document["supersedes"] is None or document["qualification"] == "confirmed":
            raise ValidationError("qualification update must supersede and reduce a prior decision")
        if not chain["regression_evidence_refs"]:
            raise ValidationError("reduced qualification requires regression evidence")
    if evidence_ids is not None:
        refs = {
            item["evidence_ref"] for item in chain["recurring_weakness"]
        } | {
            item["evidence_ref"] for item in chain["repeated_improvement"]
        } | set(chain["unresolved_contradictory_assessment_refs"]) | set(chain["regression_evidence_refs"])
        for optional in (chain["targeted_intervention"], chain["delayed_retrieval"], chain["transfer"]):
            if optional is not None:
                refs.add(optional["evidence_ref"])
        if not refs.issubset(evidence_ids):
            raise ValidationError("reinforcement decision has unresolved evidence")


def assess_result_authority(
    result: dict[str, Any] | None,
    events: list[Any],
    *,
    package: dict[str, Any] | None = None,
) -> str:
    try:
        validate_events(events, package=package, mode="complete")
    except ValidationError:
        if result is not None:
            return "QUARANTINED"
        try:
            validate_events(events, package=package, mode="prefix")
        except ValidationError:
            return "QUARANTINED"
        return "VALID_INCOMPLETE"
    if result is None:
        return "REBUILD_REQUIRED"
    try:
        validate_document("result", result)
    except ValidationError:
        return "QUARANTINED"
    event_ids = {event["event_id"] for event in events}
    artifact_ids = {
        event["payload"]["artifact_id"]
        for event in events
        if event["event_type"] == "artifact_created"
    }
    if (
        result["session_id"] != events[0]["session_id"]
        or result["package_id"] != events[0]["package_id"]
        or set(result["source_event_ids"]) != event_ids
        or not set(result["evidence_refs"]).issubset(event_ids | artifact_ids)
    ):
        return "QUARANTINED"
    return "AUTHORITATIVE"


def validate_golden(directory: Path) -> None:
    package = load_json(directory / "training-package.json")
    events = load_ndjson(directory / "events.ndjson")
    result = load_json(directory / "session-result.json")
    hypothesis = load_json(directory / "hypothesis-update.json")
    rationale = load_json(directory / "next-package-rationale.json")
    protected = load_json(directory / "protected-evaluation.json")
    artifact = load_json(directory / "artifact-metadata.json")
    validate_package(package)
    validate_protected_evaluation(protected, package)
    validate_events(
        events,
        package=package,
        artifacts={artifact["artifact_id"]: artifact},
        artifact_root=directory,
        mode="complete",
    )
    validate_session_result(result, events, package, protected)
    validate_document("hypothesis", hypothesis)
    event_ids = {event["event_id"] for event in events}
    artifact_ids = {event["payload"]["artifact_id"] for event in events if event["event_type"] == "artifact_created"}
    evidence_ids = event_ids | artifact_ids
    if any(event["package_id"] != package["package_id"] for event in events) or result["package_id"] != package["package_id"]:
        raise ValidationError("golden fixture package IDs do not agree")
    if result["session_id"] != events[0]["session_id"] or set(result["source_event_ids"]) != event_ids:
        raise ValidationError("golden result does not trace the complete event stream")
    if not set(result["evidence_refs"]).issubset(evidence_ids):
        raise ValidationError("golden result has unresolved evidence")
    hypothesis_refs = set(hypothesis["supporting_evidence"]) | set(hypothesis["contradicting_evidence"])
    if not hypothesis_refs.issubset(event_ids):
        raise ValidationError("golden hypothesis has unresolved evidence")
    required_rationale = {"schema_version", "protocol_version", "rationale_id", "source_session_id", "hypothesis_refs", "evidence_refs", "decision", "next_objective"}
    if not isinstance(rationale, dict) or set(rationale) != required_rationale:
        raise ValidationError("golden next-package rationale has invalid fields")
    if rationale["source_session_id"] != result["session_id"] or rationale["hypothesis_refs"] != [hypothesis["hypothesis_id"]] or not set(rationale["evidence_refs"]).issubset(event_ids):
        raise ValidationError("golden next-package rationale references do not resolve")


def validate_all(root: Path) -> None:
    if root.resolve() != ROOT.resolve():
        raise ValidationError("all-suite path must be repository root")
    for schema_name in SCHEMAS.values():
        schema = load_json(SCHEMA_DIR / schema_name)
        if schema.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
            raise ValidationError(f"schema dialect missing: {schema_name}")
    package_paths = [
        ROOT / "tests/protocol/fixtures/valid/minimal-training-package.json",
        ROOT / "examples/reading-training-package.json",
        ROOT / "examples/speaking-training-package.json",
        ROOT / "tests/protocol/fixtures/valid/writing-training-package.json",
        ROOT / "tests/protocol/fixtures/valid/listening-training-package.json",
        ROOT / "tests/protocol/fixtures/valid/assessment-training-package.json",
    ]
    for path in package_paths:
        validate_package(load_json(path))
    events = load_ndjson(ROOT / "examples/example-events.ndjson")
    validate_events(events, package=load_json(ROOT / "examples/reading-training-package.json"))
    validate_document("result", load_json(ROOT / "examples/example-session-result.json"))
    validate_document("artifact", load_json(ROOT / "tests/protocol/fixtures/valid/artifact-metadata.json"))
    validate_document("learner-state", load_json(ROOT / "tests/protocol/fixtures/valid/learner-state.json"))
    validate_document("hypothesis", load_json(ROOT / "tests/protocol/fixtures/golden/hypothesis-update.json"))
    validate_document("review-queue", load_json(ROOT / "tests/protocol/fixtures/valid/review-queue.json"))
    validate_document("migration-record", load_json(ROOT / "tests/protocol/fixtures/valid/migration-record.json"))
    protected_pairs = [
        (ROOT / "tests/protocol/fixtures/valid/minimal-protected-evaluation.json", ROOT / "tests/protocol/fixtures/valid/minimal-training-package.json"),
        (ROOT / "tests/protocol/fixtures/valid/listening-protected-evaluation.json", ROOT / "tests/protocol/fixtures/valid/listening-training-package.json"),
        (ROOT / "tests/protocol/fixtures/valid/protected-evaluation.json", ROOT / "tests/protocol/fixtures/valid/assessment-training-package.json"),
        (ROOT / "examples/reading-protected-evaluation.json", ROOT / "examples/reading-training-package.json"),
    ]
    for evaluation_path, package_path in protected_pairs:
        validate_protected_evaluation(load_json(evaluation_path), load_json(package_path))
    adversarial = ROOT / "tests/protocol/fixtures/adversarial"
    validate_package(load_json(adversarial / "malicious-instruction-as-data.json"))
    validate_events(load_ndjson(adversarial / "valid-incomplete-event-prefix.ndjson"), package=load_json(package_paths[0]), mode="prefix")
    validate_events(load_ndjson(adversarial / "interrupted-session.ndjson"), package=load_json(package_paths[0]), mode="prefix")
    package = load_json(package_paths[0])
    package_hash = canonical_document_hash(package)
    if classify_package_identity(load_json(adversarial / "duplicate-package-same.json"), {package["package_id"]: package_hash}) != "idempotent":
        raise ValidationError("same-hash duplicate is not idempotent")
    expected_invalid = [
        lambda: classify_package_identity(load_json(adversarial / "duplicate-package-collision.json"), {package["package_id"]: package_hash}),
        lambda: validate_events(load_ndjson(adversarial / "duplicate-resume.ndjson"), package=package),
        lambda: validate_events(load_ndjson(adversarial / "typed-event-invalid-payload.ndjson"), package=package),
        lambda: validate_events(load_ndjson(adversarial / "unknown-activity.ndjson"), package=package),
        lambda: validate_package(load_json(adversarial / "assessment-answer-leakage.json")),
        lambda: validate_reinforcement_decision(load_json(adversarial / "reward-hacking-easy-repetition.json")),
    ]
    for check in expected_invalid:
        try:
            check()
        except ValidationError:
            pass
        else:
            raise ValidationError("adversarial fixture was unexpectedly accepted")
    validate_events(load_ndjson(adversarial / "clock-rollback.ndjson"), package=package)
    if assess_result_authority(None, load_ndjson(adversarial / "completed-event-missing-result/events.ndjson")) != "REBUILD_REQUIRED":
        raise ValidationError("missing result recovery classification failed")
    if assess_result_authority(load_json(adversarial / "result-with-invalid-events/session-result.json"), load_ndjson(adversarial / "result-with-invalid-events/events.ndjson")) != "QUARANTINED":
        raise ValidationError("invalid evidence did not quarantine result")
    validate_reinforcement_decision(load_json(adversarial / "pattern-broken-regression/historical-award.json"))
    validate_reinforcement_decision(load_json(adversarial / "pattern-broken-regression/current-regression.json"))
    validate_document("hypothesis", load_json(adversarial / "hypothesis-rejected.json"))
    for name in ("writing-checkpoint", "speaking-checkpoint"):
        directory = adversarial / name
        package_a = load_json(directory / "package-a.json")
        validate_package(package_a)
        validate_checkpoint(load_json(directory / "checkpoint.json"), package_a)
        validate_package(load_json(directory / "package-b.json"))
    validate_golden(ROOT / "tests/protocol/fixtures/golden")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic Band8 protocol validator")
    parser.add_argument("kind", choices=[*SCHEMAS, "golden", "all"])
    parser.add_argument("path", type=Path)
    parser.add_argument("--seen-package-id", action="append", default=[])
    parser.add_argument("--seen-package-hash", action="append", default=[])
    parser.add_argument("--mode", choices=["prefix", "complete"], default="complete")
    parser.add_argument("--package", type=Path)
    parser.add_argument("--artifact-metadata", type=Path, action="append", default=[])
    parser.add_argument("--artifact-root", type=Path)
    args = parser.parse_args(argv)
    try:
        if args.kind == "package":
            if len(args.seen_package_id) != len(args.seen_package_hash):
                raise ValidationError("seen package IDs and hashes must be paired")
            identity = validate_package(
                load_json(args.path),
                dict(zip(args.seen_package_id, args.seen_package_hash)),
            )
            if identity == "idempotent":
                print(f"IDEMPOTENT: package: {args.path}")
        elif args.kind == "events":
            package = load_json(args.package) if args.package else None
            artifact_documents = [load_json(path) for path in args.artifact_metadata]
            validate_events(
                load_ndjson(args.path),
                package=package,
                artifacts={item["artifact_id"]: item for item in artifact_documents} if args.artifact_metadata else None,
                artifact_root=args.artifact_root,
                mode=args.mode,
            )
        elif args.kind in {"result", "artifact", "learner-state", "hypothesis", "review-queue", "checkpoint", "protected-evaluation", "reinforcement-decision", "migration-record"}:
            validate_document(args.kind, load_json(args.path))
        elif args.kind == "golden":
            validate_golden(args.path)
        else:
            validate_all(args.path)
    except ValidationError as exc:
        print(f"INVALID: {exc}", file=sys.stderr)
        return 1
    print(f"VALID: {args.kind}: {args.path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
