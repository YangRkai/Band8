from __future__ import annotations

import subprocess
import sys
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR = ROOT / "tests" / "protocol" / "validate_protocol.py"
FIXTURES = ROOT / "tests" / "protocol" / "fixtures"
EXAMPLES = ROOT / "examples"


class ProtocolValidationTests(unittest.TestCase):
    def run_validator(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(VALIDATOR), *arguments],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=False,
        )

    def test_minimal_training_package_is_accepted(self) -> None:
        result = self.run_validator(
            "package", str(FIXTURES / "valid" / "minimal-training-package.json")
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_reading_speaking_and_writing_packages_are_accepted(self) -> None:
        paths = [
            EXAMPLES / "reading-training-package.json",
            EXAMPLES / "speaking-training-package.json",
            FIXTURES / "valid" / "writing-training-package.json",
        ]
        for path in paths:
            with self.subTest(path=path.name):
                result = self.run_validator("package", str(path))
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_listening_and_assessment_packages_are_accepted(self) -> None:
        paths = [
            FIXTURES / "valid" / "listening-training-package.json",
            FIXTURES / "valid" / "assessment-training-package.json",
        ]
        for path in paths:
            with self.subTest(path=path.name):
                result = self.run_validator("package", str(path))
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_event_result_artifact_and_state_documents_are_accepted(self) -> None:
        cases = [
            ("events", EXAMPLES / "example-events.ndjson"),
            ("result", EXAMPLES / "example-session-result.json"),
            ("artifact", FIXTURES / "valid" / "artifact-metadata.json"),
            ("learner-state", FIXTURES / "valid" / "learner-state.json"),
            ("hypothesis", FIXTURES / "golden" / "hypothesis-update.json"),
            ("review-queue", FIXTURES / "valid" / "review-queue.json"),
        ]
        for kind, path in cases:
            with self.subTest(kind=kind):
                result = self.run_validator(kind, str(path))
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_package_security_and_contract_failures_are_rejected(self) -> None:
        base = json.loads(
            (FIXTURES / "valid" / "minimal-training-package.json").read_text(
                encoding="utf-8"
            )
        )

        def mutate_unknown_primitive(doc: dict) -> None:
            doc["activities"][0]["type"] = "RUN_SHELL"

        def mutate_missing_id(doc: dict) -> None:
            del doc["activities"][0]["activity_id"]

        def mutate_duplicate_ids(doc: dict) -> None:
            doc["activities"].append(deepcopy(doc["activities"][0]))

        def mutate_malformed_activity(doc: dict) -> None:
            del doc["activities"][0]["config"]

        def mutate_protocol_version(doc: dict) -> None:
            doc["protocol_version"] = "9.9.9"

        def mutate_path_traversal(doc: dict) -> None:
            doc["resources"][0]["content"] = "../../outside.txt"

        def mutate_absolute_path(doc: dict) -> None:
            doc["resources"][0]["content"] = "C:\\Windows\\system.ini"

        def mutate_executable_content(doc: dict) -> None:
            doc["resources"][0]["content"] = "<script>alert(1)</script>"

        def mutate_unsupported_field(doc: dict) -> None:
            doc["arbitrary_ui"] = {"component": "RemoteWidget"}

        def mutate_excessive_nesting(doc: dict) -> None:
            nested: dict = {}
            cursor = nested
            for index in range(20):
                cursor["level"] = {"index": index}
                cursor = cursor["level"]
            doc["activities"][0]["config"]["nested"] = nested

        def mutate_excessive_activity_count(doc: dict) -> None:
            original = doc["activities"][0]
            doc["activities"] = []
            doc["phases"][0]["activity_ids"] = []
            for index in range(65):
                activity = deepcopy(original)
                activity["activity_id"] = f"act-{index:03d}"
                doc["activities"].append(activity)
                doc["phases"][0]["activity_ids"].append(activity["activity_id"])

        def mutate_invalid_evidence_ref(doc: dict) -> None:
            doc["training_rationale"]["evidence_refs"] = ["evt-missing"]

        mutations = {
            "unknown primitive": mutate_unknown_primitive,
            "missing ID": mutate_missing_id,
            "duplicate IDs": mutate_duplicate_ids,
            "malformed activity": mutate_malformed_activity,
            "invalid protocol version": mutate_protocol_version,
            "path traversal": mutate_path_traversal,
            "absolute path": mutate_absolute_path,
            "executable content": mutate_executable_content,
            "unsupported fields": mutate_unsupported_field,
            "excessive nesting": mutate_excessive_nesting,
            "excessive activity count": mutate_excessive_activity_count,
            "invalid evidence ref": mutate_invalid_evidence_ref,
        }
        with tempfile.TemporaryDirectory() as directory:
            for label, mutation in mutations.items():
                with self.subTest(label=label):
                    document = deepcopy(base)
                    mutation(document)
                    path = Path(directory) / f"invalid-{len(label)}.json"
                    path.write_text(json.dumps(document), encoding="utf-8")
                    result = self.run_validator("package", str(path))
                    self.assertNotEqual(result.returncode, 0, label)

    def test_invalid_event_sequence_is_rejected(self) -> None:
        events = [
            {
                "schema_version": "0.1.0",
                "protocol_version": "0.1.0",
                "event_id": "evt-002",
                "event_type": "session_completed",
                "session_id": "session-invalid",
                "package_id": "pkg-minimal-001",
                "activity_id": None,
                "timestamp": "2026-08-26T00:01:00Z",
                "monotonic_offset_ms": 60000,
                "sequence_number": 2,
                "payload": {},
            },
            {
                "schema_version": "0.1.0",
                "protocol_version": "0.1.0",
                "event_id": "evt-001",
                "event_type": "session_started",
                "session_id": "session-invalid",
                "package_id": "pkg-minimal-001",
                "activity_id": None,
                "timestamp": "2026-08-26T00:00:00Z",
                "monotonic_offset_ms": 0,
                "sequence_number": 1,
                "payload": {},
            },
        ]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.ndjson"
            path.write_text(
                "\n".join(json.dumps(event) for event in events) + "\n",
                encoding="utf-8",
            )
            result = self.run_validator("events", str(path))
            self.assertNotEqual(result.returncode, 0)

    def test_duplicate_package_id_is_rejected(self) -> None:
        result = self.run_validator(
            "package",
            str(FIXTURES / "valid" / "minimal-training-package.json"),
            "--seen-package-id",
            "pkg-minimal-001",
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("duplicate package_id", result.stderr)

    def test_golden_fixture_closes_the_protocol_loop(self) -> None:
        result = self.run_validator("golden", str(FIXTURES / "golden"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_complete_protocol_suite_command_passes(self) -> None:
        result = self.run_validator("all", str(ROOT))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
