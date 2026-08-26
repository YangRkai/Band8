# Band8 Data Flow

## Objective flow

Coach emits package plus, when required, a separate protected evaluation document. Import Gate validates schema, canonical package identity, contract set, references, provenance, and protected integrity. Runtime sends learner-visible package fields to Renderer while keeping protected entries outside that projection. Learner responses become typed events; Runtime derives objective results from protected rules after the allowed boundary.

## Subjective continuation flow

Writing and Speaking use Package A → durable artifact → checkpoint manifest → `AWAITING_COACH` → Coach reads required DATA ONLY → Package B continuation → revision/repeat → novel transfer. Package B binds the prior package, segment, checkpoint, and evidence and cannot update the prior segment.

## Evidence commit flow

1. Runtime assigns immutable IDs and contiguous sequence numbers.
2. Sequence and monotonic offsets determine order; wall time is observational.
3. Artifact bytes become durable and hash-verified before metadata and a referencing event commit.
4. Typed events resolve session/run/segment/package/activity/attempt context.
5. Results derive from valid events, verified artifacts, and protected evaluation.
6. Inference and reinforcement decisions cite evidence without becoming raw facts.
7. Export preserves the complete graph and recorded semantics.

## Failure and recovery

- A valid nonterminal event prefix is `VALID_INCOMPLETE` and can resume.
- Same package ID/hash is an idempotent no-op; same ID/different hash is rejected collision.
- Replayed resume operation is a no-op and cannot append another semantic event.
- Terminal evidence without result produces `REBUILD_REQUIRED`.
- Result with invalid raw events becomes non-authoritative and the run is `QUARANTINED`.
- Missing artifact metadata/bytes or hash mismatch prevents its referencing event from being valid.
- Physical orphan artifacts are not evidence.
