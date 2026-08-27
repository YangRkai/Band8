# Band8

Band8 is a protocol-first, local-first IELTS personalized training runtime.

Core boundary:

- Band8 Runtime executes training and records evidence.
- External Codex Coach diagnoses the learner and compiles training packages.
- Band8 and the Coach communicate through the versioned Band8 Training Protocol (B8TP).
- Raw learning evidence and model inference remain separate.

Current stage:

Phase 1C — Evidence-Driven Reinforcement Engine.

The current headless Node.js/TypeScript kernel preserves the Phase 1A and Phase 1B1 paths and adds deterministic mission, effective-day/streak, evidence-backed reveal, transfer/retention eligibility, and frozen `PATTERN_BROKEN 0.1.0` decisions with historical/current qualification separation. Reinforcement never rewrites raw evidence, Coach inference, or assessment truth, and the Runtime does not call an AI model or assign subjective IELTS scores.

See [Phase 1A Runtime](docs/runtime/PHASE1A_RUNTIME.md) for local commands and storage guarantees.
See [Phase 1B1 Writing Coach Loop](docs/runtime/PHASE1B1_WRITING_COACH_LOOP.md) for the artifact, checkpoint, continuation, and trust boundaries.
See [Phase 1C Reinforcement Engine](docs/runtime/PHASE1C_REINFORCEMENT_ENGINE.md) for deterministic policy, persistence, open-loop mission, streak, reveal, and anti-reward-hacking guarantees.
