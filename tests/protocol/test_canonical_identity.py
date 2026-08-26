from __future__ import annotations

import json
import math
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path

from tests.protocol.validate_protocol import (
    ValidationError,
    canonical_document_hash,
    canonical_json_bytes,
    load_json,
    load_ndjson,
    strict_json_loads,
    validate_events,
)


class CanonicalIdentityErratumTests(unittest.TestCase):
    def test_shared_jcs_conformance_fixture(self) -> None:
        root = Path(__file__).resolve().parents[2]
        cases = load_json(
            root / "tests" / "protocol" / "fixtures" / "canonicalization" / "jcs-conformance.json"
        )
        for case in cases:
            with self.subTest(name=case["name"]):
                if case["valid"]:
                    parsed = strict_json_loads(case["input_json"])
                    self.assertEqual(
                        canonical_json_bytes(parsed),
                        case["canonical_json"].encode("utf-8"),
                    )
                else:
                    with self.assertRaises(ValidationError):
                        parsed = strict_json_loads(case["input_json"])
                        canonical_json_bytes(parsed)

    def test_integer_and_integral_float_have_identical_canonical_bytes(self) -> None:
        integral_float = json.loads('{"score":8.0}')
        integer = json.loads('{"score":8}')

        self.assertEqual(canonical_json_bytes(integral_float), b'{"score":8}')
        self.assertEqual(canonical_json_bytes(integer), b'{"score":8}')
        self.assertEqual(
            canonical_document_hash(integral_float),
            canonical_document_hash(integer),
        )

    def test_representative_jcs_values_have_expected_canonical_bytes(self) -> None:
        document = json.loads(
            '{"zero":-0.0,"unicode":"é","nested":{"z":4.50,"a":2e-3},'
            '"array":[3,{"b":2,"a":1}]}'
        )

        self.assertEqual(
            canonical_json_bytes(document),
            '{"array":[3,{"a":1,"b":2}],"nested":{"a":0.002,"z":4.5},'
            '"unicode":"é","zero":0}'.encode("utf-8"),
        )

    def test_strict_parser_rejects_duplicate_object_names(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "duplicate.json"
            path.write_text('{"package_id":"first","package_id":"second"}', encoding="utf-8")

            with self.assertRaisesRegex(ValidationError, "duplicate JSON object property"):
                load_json(path)

    def test_jcs_rejects_non_finite_and_unsafe_integer_values(self) -> None:
        for value in (math.nan, math.inf, -math.inf, 9_007_199_254_740_992):
            with self.subTest(value=value):
                with self.assertRaises(ValidationError):
                    canonical_json_bytes({"value": value})

    def test_jcs_rejects_lone_surrogate_strings(self) -> None:
        with self.assertRaises(ValidationError):
            canonical_json_bytes({"value": "\ud800"})

    def test_protocol_integer_fields_reject_values_outside_safe_range(self) -> None:
        root = Path(__file__).resolve().parents[2]
        events = load_ndjson(root / "examples" / "example-events.ndjson")
        unsafe = deepcopy(events)
        unsafe[0]["monotonic_offset_ms"] = 9_007_199_254_740_992

        with self.assertRaisesRegex(ValidationError, "safe integer"):
            validate_events(unsafe, mode="complete")


if __name__ == "__main__":
    unittest.main()
