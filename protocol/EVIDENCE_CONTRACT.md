# Evidence Contract 0.1

## Fact and inference

Facts include selections, correct answers, latency, revisions, play counts, hints, submitted artifacts, runtime state, and assessment observations. Inference includes diagnostic claims, confidence, training strategy, and predicted difficulty. Each record identifies its kind and producer so later models can reinterpret facts.

## Event envelope

Every event includes `event_id`, `event_type`, protocol and schema versions, session and package IDs, nullable activity ID, RFC 3339 timestamp, monotonic offset, strictly increasing sequence number, and bounded payload.

V0.1 records session lifecycle, activity lifecycle, answer selection/change/submission, audio use, text revisits, evidence selection, hints, correction, retry, self-rating, writing revisions, speaking recordings, artifacts, reinforcement decisions, and assessment submission. Mouse tracking, keyboard surveillance, and unrelated telemetry are excluded.

## Immutability

Raw events and artifact bytes are append-only. A correction, invalid record, or migration adds a record with `supersedes`, `invalidates`, or `migration_version`; it never overwrites history. Event IDs and artifact hashes remain export-stable.

## Session result

The result aggregates effective duration, completed activities, objective results, user artifacts, corrections, retries, self-assessments, abandonment, reinforcement events, and evidence references. Every summary item cites event or artifact IDs. Results cannot replace events.

## Artifacts

Essays, rewrites, speaking audio, transcripts, selected evidence, and long-form answers have metadata containing stable ID, type, creation time, source activity, SHA-256 content hash, and normalized relative path. Runtime chooses storage roots; package content cannot supply a host path.

## Review queue

Band8 stores due constraints and review history. The Coach decides whether and how a due item appears in the next package. Runtime preserves constraints but does not decide pedagogy.

## Score labels

`official_result`, `practice_result`, `ai_estimate`, and `coach_inference` are distinct. Writing and speaking estimates include estimate, confidence, rubric dimensions, evidence references, producer, and version. No estimate is labeled official.
