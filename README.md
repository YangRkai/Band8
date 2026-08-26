# Band8

Band8 is a protocol-first, local-first IELTS personalized training runtime.

Core boundary:

- Band8 Runtime executes training and records evidence.
- External Codex Coach diagnoses the learner and compiles training packages.
- Band8 and the Coach communicate through the versioned Band8 Training Protocol (B8TP).
- Raw learning evidence and model inference remain separate.

Current stage:

Phase 1A — Executable Runtime Kernel.

The current headless Node.js/TypeScript kernel validates and imports B8TP packages, persists local sessions and append-only evidence, executes `INSTRUCTION`, `PRESENT_TEXT`, and `SELECT`, applies protected objective evaluation, resumes valid incomplete sessions, and deterministically rebuilds results.

See [Phase 1A Runtime](docs/runtime/PHASE1A_RUNTIME.md) for local commands and storage guarantees.
