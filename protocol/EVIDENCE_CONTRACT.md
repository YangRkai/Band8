# Evidence Contract 0.1

## Fact, inference, and authority

Raw selections, responses, timing, revisions, media use, artifacts, runtime state, protected-evaluation observations, and assessment observations are facts. Diagnosis, confidence, strategy, predicted difficulty, and prior model output are inference. Every record identifies kind, producer, version, and evidence references. Raw evidence authority always exceeds derived summaries; neither inference nor reward state can rewrite facts.

All evidence and inference presented to the Coach is DATA ONLY under `COACH_INPUT_TRUST.md`.

## Event envelope and typed payloads

Every event binds `session_id`, `run_id`, `segment_id`, `package_id`, nullable resolved `activity_id`, RFC 3339 wall time, session-relative monotonic offset, contiguous sequence number, and an event-type-specific closed payload. Payloads form a semantic discriminated union: each `event_type` has required and allowed fields, and unknown fields are rejected.

Response events record raw response values or stable output references, never a self-reported correctness outcome. Correctness is deterministically derived from protected evaluation or is later Coach inference for subjective work.

## State and prefix validity

Segment state is one of `CREATED`, `READY`, `RUNNING`, `AWAITING_COACH`, `SUSPENDED`, `COMPLETED`, `ABORTED`, or `QUARANTINED`. Legal transitions are:

- `CREATED → READY` after package and protected inputs validate;
- `READY → RUNNING` when sequence 1 `session_started` commits;
- `RUNNING ↔ SUSPENDED` through pause/resume;
- `RUNNING → AWAITING_COACH` through a declared Coach checkpoint;
- `AWAITING_COACH → READY` only for a validated continuation segment;
- `RUNNING|SUSPENDED → COMPLETED|ABORTED` through terminal evidence;
- any state → `QUARANTINED` when authoritative evidence integrity fails.

A contiguous, schema-valid prefix beginning with `session_started` is `VALID_INCOMPLETE`; absence of a terminal event is not corruption. Complete validation additionally requires an allowed terminal event and no active activity.

## Ordering and clock semantics

`sequence_number` plus `monotonic_offset_ms` determines order within a segment. Wall-clock timestamp records real-world time but does not override sequence truth. A backward wall-clock jump is recorded by `clock_anomaly_detected`; it does not invalidate an otherwise ordered stream.

## Resume idempotency

Every resume request has a stable `resume_operation_id`. Replaying the same operation is a no-op and cannot append a second semantic resume event. Two emitted events with the same resume operation make the stream invalid.

## Artifact commit order

Artifact bytes must become durable, then their SHA-256 must verify, then metadata becomes durable, and only then may an `artifact_created` or other referencing event commit. A valid event cannot reference missing metadata or bytes. Physical orphan bytes are not evidence and may be handled by later reconciliation without becoming factual history.

## Results and quarantine

Session result is a deterministic projection of authoritative events, protected evaluation, and verified artifacts. It never replaces them. A terminal event with a missing result yields `REBUILD_REQUIRED`; Runtime may rebuild and atomically publish a validated result. A result with an invalid raw event stream loses factual authority and the run enters `QUARANTINED`.

Recommended persistence is temporary result → validate against authoritative evidence → atomic publish. This is a Phase 0 contract, not a storage implementation.

## Immutability and migration

Raw events and artifact bytes are append-only. Correction, invalidation, supersession, and migration add typed records that resolve their targets. A migration record preserves source identity and hash, records from/to contract sets and migration version, creates a new record identity, and asserts that the original remains preserved.

## Score labels

`official_result`, `practice_result`, `ai_estimate`, and `coach_inference` remain distinct. Writing and Speaking estimates include confidence, rubric dimensions, evidence references, producer, and version and never claim official examiner status.
