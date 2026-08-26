from __future__ import annotations

import json
import unittest
from copy import deepcopy
from pathlib import Path

from tests.protocol.validate_protocol import (
    ValidationError,
    assess_result_authority,
    canonical_document_hash,
    classify_package_identity,
    load_json,
    load_ndjson,
    validate_checkpoint,
    validate_continuation,
    validate_events,
    validate_package,
    validate_protected_evaluation,
    validate_reinforcement_decision,
    validate_session_result,
)


ROOT = Path(__file__).resolve().parents[2]
VALID = ROOT / "tests" / "protocol" / "fixtures" / "valid"
ADVERSARIAL = ROOT / "tests" / "protocol" / "fixtures" / "adversarial"


class Phase06ProtocolClosureTests(unittest.TestCase):
    def test_instruction_like_learning_content_remains_valid_data(self) -> None:
        package = load_json(ADVERSARIAL / "malicious-instruction-as-data.json")
        validate_package(package)

    def test_obsolete_composite_primitives_are_rejected(self) -> None:
        base = load_json(VALID / "minimal-training-package.json")
        for primitive, config in (
            (
                "RETRIEVAL_PROMPT",
                {"response_mode": "text", "prior_evidence_refs": ["evt-old-001"]},
            ),
            (
                "COMPARE_REVISE",
                {
                    "source_activity_id": "act-1",
                    "revision_kind": "rewrite",
                    "artifact_type": "rewrite",
                },
            ),
        ):
            with self.subTest(primitive=primitive):
                package = deepcopy(base)
                package["activities"][0]["type"] = primitive
                package["activities"][0]["config"] = config
                with self.assertRaises(ValidationError):
                    validate_package(package)

    def test_incomplete_event_prefix_is_valid_only_in_prefix_mode(self) -> None:
        package = load_json(VALID / "minimal-training-package.json")
        events = load_ndjson(ADVERSARIAL / "valid-incomplete-event-prefix.ndjson")
        validate_events(events, package=package, mode="prefix")
        with self.assertRaises(ValidationError):
            validate_events(events, package=package, mode="complete")

    def test_duplicate_package_identity_is_idempotent_only_for_same_hash(self) -> None:
        package = load_json(VALID / "minimal-training-package.json")
        package_hash = canonical_document_hash(package)
        self.assertEqual(
            classify_package_identity(package, {package["package_id"]: package_hash}),
            "idempotent",
        )
        collision = deepcopy(package)
        collision["session_intent"]["objective"] = "Different canonical content."
        with self.assertRaises(ValidationError):
            classify_package_identity(collision, {package["package_id"]: package_hash})

    def test_duplicate_resume_operation_is_rejected(self) -> None:
        package = load_json(VALID / "minimal-training-package.json")
        events = load_ndjson(ADVERSARIAL / "duplicate-resume.ndjson")
        with self.assertRaises(ValidationError):
            validate_events(events, package=package, mode="complete")

    def test_event_payload_is_discriminated_and_context_resolved(self) -> None:
        package = load_json(VALID / "minimal-training-package.json")
        events = load_ndjson(ADVERSARIAL / "typed-event-invalid-payload.ndjson")
        with self.assertRaises(ValidationError):
            validate_events(events, package=package, mode="complete")
        events = load_ndjson(ADVERSARIAL / "unknown-activity.ndjson")
        with self.assertRaises(ValidationError):
            validate_events(events, package=package, mode="complete")

    def test_artifact_reference_requires_metadata_and_matching_bytes(self) -> None:
        package = load_json(ADVERSARIAL / "artifact-integrity" / "training-package.json")
        events = load_ndjson(ADVERSARIAL / "artifact-integrity" / "events.ndjson")
        metadata = load_json(ADVERSARIAL / "artifact-integrity" / "artifact-metadata.json")
        with self.assertRaises(ValidationError):
            validate_events(events, package=package, artifacts={}, mode="complete")
        with self.assertRaises(ValidationError):
            validate_events(
                events,
                package=package,
                artifacts={metadata["artifact_id"]: metadata},
                artifact_root=ADVERSARIAL / "artifact-integrity",
                mode="complete",
            )

    def test_result_authority_follows_raw_events(self) -> None:
        completed = load_ndjson(ADVERSARIAL / "completed-event-missing-result" / "events.ndjson")
        self.assertEqual(assess_result_authority(None, completed), "REBUILD_REQUIRED")
        invalid = load_ndjson(ADVERSARIAL / "result-with-invalid-events" / "events.ndjson")
        result = load_json(ADVERSARIAL / "result-with-invalid-events" / "session-result.json")
        self.assertEqual(assess_result_authority(result, invalid), "QUARANTINED")

    def test_assessment_uses_non_projectable_protected_evaluation(self) -> None:
        package = load_json(VALID / "assessment-training-package.json")
        protected = load_json(VALID / "protected-evaluation.json")
        validate_protected_evaluation(protected, package)
        leakage = load_json(ADVERSARIAL / "assessment-answer-leakage.json")
        with self.assertRaises(ValidationError):
            validate_package(leakage)

    def test_reinforcement_policy_rejects_reward_hacking_and_preserves_regression(self) -> None:
        hacking = load_json(ADVERSARIAL / "reward-hacking-easy-repetition.json")
        with self.assertRaises(ValidationError):
            validate_reinforcement_decision(hacking)
        award = load_json(ADVERSARIAL / "pattern-broken-regression" / "historical-award.json")
        regression = load_json(ADVERSARIAL / "pattern-broken-regression" / "current-regression.json")
        validate_reinforcement_decision(award)
        validate_reinforcement_decision(regression)
        self.assertEqual(award["decision_type"], "historical_award")
        self.assertEqual(regression["qualification"], "revoked")
        self.assertEqual(regression["supersedes"], award["decision_id"])

    def test_resource_provenance_is_required_and_hash_verified(self) -> None:
        package = load_json(VALID / "minimal-training-package.json")
        validate_package(package)
        missing = deepcopy(package)
        del missing["resources"][0]["provenance"]
        with self.assertRaises(ValidationError):
            validate_package(missing)
        mismatch = deepcopy(package)
        mismatch["resources"][0]["content"] += " changed"
        with self.assertRaises(ValidationError):
            validate_package(mismatch)

    def test_writing_and_speaking_checkpoint_continuations_validate(self) -> None:
        for name in ("writing-checkpoint", "speaking-checkpoint"):
            with self.subTest(name=name):
                directory = ADVERSARIAL / name
                package_a = load_json(directory / "package-a.json")
                checkpoint = load_json(directory / "checkpoint.json")
                package_b = load_json(directory / "package-b.json")
                validate_package(package_a)
                validate_checkpoint(checkpoint, package_a)
                validate_package(package_b)
                validate_continuation(package_b, package_a, checkpoint)

    def test_result_binds_full_context_and_is_rederived(self) -> None:
        directory = ROOT / "tests" / "protocol" / "fixtures" / "golden"
        package = load_json(directory / "training-package.json")
        events = load_ndjson(directory / "events.ndjson")
        protected = load_json(directory / "protected-evaluation.json")
        result = load_json(directory / "session-result.json")
        validate_session_result(result, events, package, protected)
        self.assertEqual(result["run_id"], package["run_id"])
        self.assertEqual(result["segment_id"], package["segment_id"])
        false_summary = deepcopy(result)
        false_summary["objective_results"][0]["outcome"] = "unsuccessful"
        with self.assertRaises(ValidationError):
            validate_session_result(false_summary, events, package, protected)

    def test_resume_requires_suspended_state_and_checkpoint_must_match_package(self) -> None:
        package = load_json(VALID / "minimal-training-package.json")
        events = load_ndjson(ADVERSARIAL / "completed-event-missing-result" / "events.ndjson")
        resumed = deepcopy(events[0])
        resumed["event_id"] = "evt-illegal-resume-002"
        resumed["event_type"] = "session_resumed"
        resumed["sequence_number"] = 2
        resumed["monotonic_offset_ms"] = 1000
        resumed["payload"] = {"resume_operation_id": "resume-op-illegal"}
        completed = deepcopy(events[1])
        completed["sequence_number"] = 3
        with self.assertRaises(ValidationError):
            validate_events([events[0], resumed, completed], package=package, mode="complete")

        writing = ADVERSARIAL / "writing-checkpoint"
        package_a = load_json(writing / "package-a.json")
        checkpoint_events = [
            {
                "schema_version": "0.1.0", "protocol_version": "0.1.0",
                "event_id": "evt-checkpoint-start", "event_type": "session_started",
                "session_id": "session-writing-001", "run_id": package_a["run_id"],
                "segment_id": package_a["segment_id"], "package_id": package_a["package_id"],
                "activity_id": None, "timestamp": "2026-08-26T12:00:00Z",
                "monotonic_offset_ms": 0, "sequence_number": 1,
                "payload": {"run_id": package_a["run_id"], "segment_id": package_a["segment_id"], "mode": "training"},
            },
            {
                "schema_version": "0.1.0", "protocol_version": "0.1.0",
                "event_id": "evt-checkpoint-wrong", "event_type": "coach_checkpoint_reached",
                "session_id": "session-writing-001", "run_id": package_a["run_id"],
                "segment_id": package_a["segment_id"], "package_id": package_a["package_id"],
                "activity_id": None, "timestamp": "2026-08-26T12:01:00Z",
                "monotonic_offset_ms": 60000, "sequence_number": 2,
                "payload": {"checkpoint_id": "checkpoint-wrong", "required_evidence_refs": ["artifact-writing-original-001"]},
            },
        ]
        with self.assertRaises(ValidationError):
            validate_events(checkpoint_events, package=package_a, mode="complete")

    def test_minimal_migration_record_preserves_original(self) -> None:
        document = load_json(VALID / "migration-record.json")
        from tests.protocol.validate_protocol import validate_document

        validate_document("migration-record", document)

    def test_history_correction_fields_are_event_type_bound(self) -> None:
        package = load_json(VALID / "minimal-training-package.json")
        events = load_ndjson(ADVERSARIAL / "completed-event-missing-result" / "events.ndjson")
        events[1]["invalidates"] = events[0]["event_id"]
        with self.assertRaises(ValidationError):
            validate_events(events, package=package, mode="complete")

    def test_wall_clock_rollback_does_not_override_sequence_truth(self) -> None:
        package = load_json(VALID / "minimal-training-package.json")
        events = load_ndjson(ADVERSARIAL / "clock-rollback.ndjson")
        validate_events(events, package=package, mode="complete")

    def test_hypothesis_rejection_fixture_is_valid(self) -> None:
        document = load_json(ADVERSARIAL / "hypothesis-rejected.json")
        from tests.protocol.validate_protocol import validate_document

        validate_document("hypothesis", document)

    def test_protocol_documents_schema_subset_and_instruction_precedence(self) -> None:
        b8tp = (ROOT / "protocol" / "B8TP.md").read_text(encoding="utf-8")
        trust = (ROOT / "protocol" / "COACH_INPUT_TRUST.md").read_text(encoding="utf-8")
        self.assertIn("supported JSON Schema subset", b8tp)
        self.assertIn("DATA ONLY", trust)
        self.assertIn("repository governance", trust)


if __name__ == "__main__":
    unittest.main()
