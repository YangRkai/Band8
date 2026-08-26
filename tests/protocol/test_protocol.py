from __future__ import annotations

import subprocess
import sys
import json
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from tests.protocol.validate_protocol import canonical_document_hash


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

        def mutate_resource_hash_mismatch(doc: dict) -> None:
            doc["resources"][0]["content"] = "Changed without updating provenance hash."

        def mutate_unknown_provenance(doc: dict) -> None:
            doc["resources"][0]["provenance"]["origin_type"] = "scraped"

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
            "resource hash mismatch": mutate_resource_hash_mismatch,
            "unknown provenance": mutate_unknown_provenance,
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
            json.loads(line)
            for line in (EXAMPLES / "example-events.ndjson").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        events[5]["sequence_number"] = 99
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "events.ndjson"
            path.write_text(
                "\n".join(json.dumps(event) for event in events) + "\n",
                encoding="utf-8",
            )
            result = self.run_validator("events", str(path))
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("sequence_number", result.stderr)

    def test_duplicate_package_identity_distinguishes_idempotency_and_collision(self) -> None:
        package_path = FIXTURES / "valid" / "minimal-training-package.json"
        package = json.loads(package_path.read_text(encoding="utf-8"))
        package_hash = canonical_document_hash(package)
        same = self.run_validator(
            "package",
            str(package_path),
            "--seen-package-id",
            "pkg-minimal-001",
            "--seen-package-hash",
            package_hash,
        )
        self.assertEqual(same.returncode, 0, same.stdout + same.stderr)
        self.assertIn("IDEMPOTENT", same.stdout)
        collision = self.run_validator(
            "package",
            str(FIXTURES / "adversarial" / "duplicate-package-collision.json"),
            "--seen-package-id",
            "pkg-minimal-001",
            "--seen-package-hash",
            package_hash,
        )
        self.assertNotEqual(collision.returncode, 0)
        self.assertIn("collision", collision.stderr)

    def test_golden_fixture_closes_the_protocol_loop(self) -> None:
        result = self.run_validator("golden", str(FIXTURES / "golden"))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_complete_protocol_suite_command_passes(self) -> None:
        result = self.run_validator("all", str(ROOT))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
