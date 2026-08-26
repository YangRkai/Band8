# Protocol Versioning

## Recorded contract set

Every accepted package records:

- B8TP version;
- package schema version;
- evidence contract version;
- reinforcement contract version;
- pedagogy version;
- Coach contract version;
- skill taxonomy version;
- Runtime/interpreter version;
- validator version.

Canonical package identity uses `canonicalization_algorithm: RFC8785-JCS` followed by SHA-256. This pre-release correction replaces the earlier implementation-dependent JSON serialization wording without changing the canonical package projection or introducing a migration version. No production learner data exists under the superseded behavior.

The immutable accepted package is stored with its segment, so events, artifacts, protected evaluation, checkpoints, and results resolve to the exact semantics that produced them.

## Compatibility

V0.1 accepts the exact supported contract set `0.1.0`. Unknown major versions and unsupported combinations are rejected before acceptance. Patch versions may clarify or tighten validation only when they do not reinterpret an already valid historical record. Minor and major meaning changes require explicit support and recorded semantics.

Replay uses the recorded contract set when that interpreter remains supported. Otherwise replay returns `REPLAY_UNSUPPORTED`; it never silently applies current semantics.

## Identity and migration

Package, session, run, segment, event, artifact, checkpoint, evaluation, result, hypothesis, review, reinforcement decision, and migration IDs are immutable.

Migration creates an explicit migration record containing source identity/hash, from/to contract sets, new record identity, migration version, and `original_preserved = true`. Historical raw evidence and bytes remain unchanged. Unsupported history may remain exportable even when it cannot be replayed.

## Scope

Phase 0.6 defines the minimum record and rejection semantics. It does not implement a general migration framework or long-term compatibility matrix.
