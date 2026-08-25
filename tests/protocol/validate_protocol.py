from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from pathlib import Path, PurePosixPath
from typing import Any, Iterable


ROOT = Path(__file__).resolve().parents[2]
SCHEMA_DIR = ROOT / "protocol" / "schemas"
PROTOCOL_VERSION = "0.1.0"
MAX_DOCUMENT_BYTES = 1024 * 1024
MAX_DEPTH = 16
MAX_TEXT_LENGTH = 12000
PRIMITIVES = {
    "INSTRUCTION", "PRESENT_TEXT", "PLAY_AUDIO", "SELECT", "MATCH", "ORDER",
    "TEXT_RESPONSE", "EVIDENCE_SELECT", "SPEAK_RECORD", "COMPARE_REVISE",
    "RETRIEVAL_PROMPT", "SELF_ASSESS",
}
SCHEMAS = {
    "package": "training-package.schema.json",
    "events": "session-event.schema.json",
    "result": "session-result.schema.json",
    "artifact": "artifact-metadata.schema.json",
    "learner-state": "learner-state.schema.json",
    "hypothesis": "hypothesis.schema.json",
    "review-queue": "review-queue.schema.json",
}
DANGEROUS_TEXT = [
    re.compile(r"(?:^|[\\/])\.\.(?:[\\/]|$)"),
    re.compile(r"^[A-Za-z]:[\\/]"),
    re.compile(r"^\\\\"),
    re.compile(r"^/"),
    re.compile(r"\b(?:https?|file|javascript|data):", re.IGNORECASE),
    re.compile(r"</?(?:script|iframe|object|embed|style|link|meta)\b", re.IGNORECASE),
    re.compile(r"\b(?:powershell|cmd\.exe|bash\s+-c|sh\s+-c|rm\s+-rf|invoke-expression)\b", re.IGNORECASE),
]


class ValidationError(ValueError):
    pass


def load_json(path: Path, max_bytes: int = MAX_DOCUMENT_BYTES) -> Any:
    try:
        if path.stat().st_size > max_bytes:
            raise ValidationError(f"document exceeds {max_bytes} bytes")
        return json.loads(path.read_text(encoding="utf-8"))
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
                documents.append(json.loads(line))
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


def reject_dangerous_text(document: Any) -> None:
    for text in walk_values(document):
        if any(pattern.search(text) for pattern in DANGEROUS_TEXT):
            raise ValidationError("package contains path, URL, active-content, or executable semantics")


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
        "EVIDENCE_SELECT": ({"min_spans", "max_spans", "allow_revision", "preserve_raw_selection"}, {"min_spans", "max_spans", "allow_revision", "preserve_raw_selection"}),
        "SPEAK_RECORD": ({"min_seconds", "max_seconds", "max_takes", "artifact_type"}, {"min_seconds", "max_seconds", "max_takes", "artifact_type"}),
        "COMPARE_REVISE": ({"source_activity_id", "revision_kind", "artifact_type"}, {"source_activity_id", "revision_kind", "artifact_type"}),
        "RETRIEVAL_PROMPT": ({"response_mode", "prior_evidence_refs"}, {"response_mode", "prior_evidence_refs"}),
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
    elif primitive == "TEXT_RESPONSE":
        if config["response_kind"] not in {"short", "long", "explanation", "recall"}:
            raise ValidationError("TEXT_RESPONSE response_kind is invalid")
        if not 1 <= config["min_characters"] <= config["max_characters"] <= MAX_TEXT_LENGTH:
            raise ValidationError("TEXT_RESPONSE character bounds are invalid")
    elif primitive == "EVIDENCE_SELECT":
        if not 0 <= config["min_spans"] <= config["max_spans"] <= 20 or config["preserve_raw_selection"] is not True:
            raise ValidationError("EVIDENCE_SELECT span or preservation contract is invalid")
    elif primitive == "SPEAK_RECORD":
        if not 1 <= config["min_seconds"] <= config["max_seconds"] <= 1800 or not 1 <= config["max_takes"] <= 5 or config["artifact_type"] != "speaking_audio":
            raise ValidationError("SPEAK_RECORD bounds are invalid")
    elif primitive == "COMPARE_REVISE":
        if config["source_activity_id"] not in activity_ids:
            raise ValidationError("COMPARE_REVISE source activity does not resolve")
        if config["revision_kind"] not in {"correction", "rewrite", "repeat_speaking"}:
            raise ValidationError("COMPARE_REVISE revision_kind is invalid")
    elif primitive == "SELF_ASSESS":
        if not 0 <= config["scale_min"] < config["scale_max"] <= 10:
            raise ValidationError("SELF_ASSESS scale is invalid")
        if len(config["labels"]) != config["scale_max"] - config["scale_min"] + 1:
            raise ValidationError("SELF_ASSESS labels do not cover the scale")
    elif primitive == "PLAY_AUDIO":
        if not 1 <= config["max_plays"] <= 5 or not isinstance(config["allow_seek"], bool):
            raise ValidationError("PLAY_AUDIO config is invalid")
    elif primitive == "PRESENT_TEXT" and config["display_mode"] not in {"continuous", "paged"}:
        raise ValidationError("PRESENT_TEXT display_mode is invalid")
    elif primitive == "INSTRUCTION" and not isinstance(config["acknowledge_required"], bool):
        raise ValidationError("INSTRUCTION acknowledgement is invalid")
    elif primitive == "RETRIEVAL_PROMPT" and config["response_mode"] not in {"text", "select", "speech"}:
        raise ValidationError("RETRIEVAL_PROMPT response_mode is invalid")


def validate_package(document: Any, seen_package_ids: set[str] | None = None) -> None:
    validate_against_schema(document, SCHEMAS["package"])
    reject_dangerous_text(document)
    if document["package_id"] in (seen_package_ids or set()):
        raise ValidationError(f"duplicate package_id: {document['package_id']}")
    resources = unique_ids(document["resources"], "resource_id", "resources")
    phases = unique_ids(document["phases"], "phase_id", "phases")
    activities = unique_ids(document["activities"], "activity_id", "activities")
    ordered: list[str] = []
    for phase in document["phases"]:
        ordered.extend(phase["activity_ids"])
    if len(ordered) != len(set(ordered)) or set(ordered) != activities:
        raise ValidationError("phase activity references must cover each activity exactly once")
    for activity in document["activities"]:
        if activity["phase_id"] not in phases:
            raise ValidationError("activity phase reference does not resolve")
        if not set(activity["resource_refs"]).issubset(resources):
            raise ValidationError("activity resource reference does not resolve")
        transcript = activity["accessibility"].get("transcript_resource_ref")
        if transcript is not None and transcript not in resources:
            raise ValidationError("accessibility transcript reference does not resolve")
        validate_primitive(activity, activities)
    if not set(document["completion_policy"]["required_activity_ids"]).issubset(activities):
        raise ValidationError("completion policy references unknown activity")
    available = set(document.get("available_evidence_refs", []))
    if not set(document["training_rationale"]["evidence_refs"]).issubset(available):
        raise ValidationError("invalid evidence ref in training rationale")
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


def validate_events(events: list[Any]) -> None:
    for event in events:
        validate_against_schema(event, SCHEMAS["events"])
        list(walk_values(event))
    ids = [event["event_id"] for event in events]
    if len(ids) != len(set(ids)):
        raise ValidationError("event IDs must be unique")
    if events[0]["event_type"] != "session_started" or events[0]["sequence_number"] != 1:
        raise ValidationError("event stream must begin with sequence 1 session_started")
    if events[-1]["event_type"] not in {"session_completed", "session_abandoned"}:
        raise ValidationError("event stream must end with a terminal session event")
    session_id, package_id = events[0]["session_id"], events[0]["package_id"]
    previous_offset = -1
    previous_time: datetime | None = None
    active: set[str] = set()
    for index, event in enumerate(events, 1):
        if event["sequence_number"] != index:
            raise ValidationError("event sequence_number is not contiguous")
        if event["session_id"] != session_id or event["package_id"] != package_id:
            raise ValidationError("event stream mixes session or package IDs")
        if event["monotonic_offset_ms"] < previous_offset:
            raise ValidationError("event monotonic offsets move backwards")
        timestamp = datetime.fromisoformat(event["timestamp"].replace("Z", "+00:00"))
        if previous_time is not None and timestamp < previous_time:
            raise ValidationError("event timestamps move backwards")
        previous_offset, previous_time = event["monotonic_offset_ms"], timestamp
        activity_id = event["activity_id"]
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
    if active:
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


def validate_golden(directory: Path) -> None:
    package = load_json(directory / "training-package.json")
    events = load_ndjson(directory / "events.ndjson")
    result = load_json(directory / "session-result.json")
    hypothesis = load_json(directory / "hypothesis-update.json")
    rationale = load_json(directory / "next-package-rationale.json")
    validate_package(package)
    validate_events(events)
    validate_document("result", result)
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
    validate_events(events)
    validate_document("result", load_json(ROOT / "examples/example-session-result.json"))
    validate_document("artifact", load_json(ROOT / "tests/protocol/fixtures/valid/artifact-metadata.json"))
    validate_document("learner-state", load_json(ROOT / "tests/protocol/fixtures/valid/learner-state.json"))
    validate_document("hypothesis", load_json(ROOT / "tests/protocol/fixtures/golden/hypothesis-update.json"))
    validate_document("review-queue", load_json(ROOT / "tests/protocol/fixtures/valid/review-queue.json"))
    validate_golden(ROOT / "tests/protocol/fixtures/golden")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Deterministic Band8 protocol validator")
    parser.add_argument("kind", choices=[*SCHEMAS, "golden", "all"])
    parser.add_argument("path", type=Path)
    parser.add_argument("--seen-package-id", action="append", default=[])
    args = parser.parse_args(argv)
    try:
        if args.kind == "package":
            validate_package(load_json(args.path), set(args.seen_package_id))
        elif args.kind == "events":
            validate_events(load_ndjson(args.path))
        elif args.kind in {"result", "artifact", "learner-state", "hypothesis", "review-queue"}:
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
