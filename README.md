# Band8

Band8 is a protocol-first, local-first IELTS personalized training runtime.

Core boundary:

- Band8 Runtime executes training and records evidence.
- External Codex Coach diagnoses the learner and compiles training packages.
- Band8 and the Coach communicate through the versioned Band8 Training Protocol (B8TP).
- Raw learning evidence and model inference remain separate.

Current stage:

Phase 1B1 — Artifact + External Coach Checkpoint + Writing Vertical Loop.

The current headless Node.js/TypeScript kernel preserves the Phase 1A objective-learning path and adds immutable UTF-8 learner artifacts, `TEXT_RESPONSE`, persisted Coach checkpoints, DATA-only local exchange bundles, validated continuation attachment, targeted Writing revision, and changed-material transfer. The Runtime does not call an AI model, diagnose Writing, or assign subjective IELTS scores.

See [Phase 1A Runtime](docs/runtime/PHASE1A_RUNTIME.md) for local commands and storage guarantees.
See [Phase 1B1 Writing Coach Loop](docs/runtime/PHASE1B1_WRITING_COACH_LOOP.md) for the artifact, checkpoint, continuation, and trust boundaries.
