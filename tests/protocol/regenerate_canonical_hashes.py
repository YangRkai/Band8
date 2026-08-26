from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from tests.protocol.validate_protocol import canonical_document_hash, load_json


ROOT = Path(__file__).resolve().parents[2]

PROTECTED_BINDINGS = (
    ("examples/reading-training-package.json", "examples/reading-protected-evaluation.json"),
    ("tests/protocol/fixtures/golden/training-package.json", "tests/protocol/fixtures/golden/protected-evaluation.json"),
    ("tests/protocol/fixtures/valid/minimal-training-package.json", "tests/protocol/fixtures/valid/minimal-protected-evaluation.json"),
    ("tests/protocol/fixtures/valid/listening-training-package.json", "tests/protocol/fixtures/valid/listening-protected-evaluation.json"),
    ("tests/protocol/fixtures/valid/assessment-training-package.json", "tests/protocol/fixtures/valid/protected-evaluation.json"),
)

CHECKPOINT_BINDINGS = (
    ("tests/protocol/fixtures/adversarial/writing-checkpoint/package-a.json", "tests/protocol/fixtures/adversarial/writing-checkpoint/checkpoint.json"),
    ("tests/protocol/fixtures/adversarial/speaking-checkpoint/package-a.json", "tests/protocol/fixtures/adversarial/speaking-checkpoint/checkpoint.json"),
)


def write_json(path: Path, document: Any) -> None:
    path.write_text(
        json.dumps(document, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def refresh_protected_binding(package_path: Path, evaluation_path: Path) -> None:
    package = load_json(package_path)
    evaluation = load_json(evaluation_path)
    for entry in evaluation["entries"]:
        payload = {key: value for key, value in entry.items() if key != "integrity_ref"}
        entry["integrity_ref"] = canonical_document_hash(payload)
    evaluation["content_hash"] = canonical_document_hash(evaluation["entries"])
    reference = package["protected_evaluation_ref"]
    if reference is None:
        raise ValueError(f"protected evaluation reference missing: {package_path}")
    reference["content_hash"] = evaluation["content_hash"]
    evaluation["package_hash"] = canonical_document_hash(package)
    write_json(package_path, package)
    write_json(evaluation_path, evaluation)


def refresh_checkpoint_binding(package_path: Path, checkpoint_path: Path) -> None:
    package = load_json(package_path)
    checkpoint = load_json(checkpoint_path)
    checkpoint["package_hash"] = canonical_document_hash(package)
    write_json(checkpoint_path, checkpoint)


def main() -> None:
    for package_name, evaluation_name in PROTECTED_BINDINGS:
        refresh_protected_binding(ROOT / package_name, ROOT / evaluation_name)
    for package_name, checkpoint_name in CHECKPOINT_BINDINGS:
        refresh_checkpoint_binding(ROOT / package_name, ROOT / checkpoint_name)


if __name__ == "__main__":
    main()
