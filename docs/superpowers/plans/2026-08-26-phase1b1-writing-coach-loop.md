# Band8 Phase 1B1 Writing Coach Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Close one local Writing loop from durable learner artifact through an External Coach checkpoint and validated continuation to rewrite, changed-material transfer, and authoritative evidence.

**Architecture:** Keep the frozen B8TP documents closed and unchanged. Add focused Runtime stores for immutable text artifacts and file-based Coach exchange, then extend the existing Runtime orchestrator with `TEXT_RESPONSE`, checkpoint termination, continuation attachment, and subjective-result derivation without model calls.

**Tech Stack:** Node.js 20, TypeScript 5.7, AJV 8 Draft 2020-12 validation, RFC 8785 JCS, Vitest 2.1, Python protocol oracle.

**Spec:** User-approved `Band8 Phase 1B1 — Artifact + External Coach Checkpoint + Writing Vertical Loop` request dated 2026-08-26.

## Global Constraints

- Work only in the Band8 repository on `feature/phase1b1-writing-coach-loop` from `d5cb4d8bf9062d52942637ba26c5448a9ba06ef7`.
- Do not modify B8TP schemas, JCS identity, raw evidence, or Phase 1A semantics.
- Runtime performs no AI diagnosis, subjective scoring, Coach generation, network access, deployment, or push.
- Support only UTF-8 text artifacts and `TEXT_RESPONSE`; Speaking/audio remains outside scope.
- Every production behavior begins with an observed failing test and ends with regression verification.
- Create only the final authorized local commit `feat: close Band8 external writing coach loop` after fresh verification.

---

### Task 1: Frozen protocol validator surfaces

**Files:**
- Modify: `src/protocol/schema-validator.ts`
- Modify: `src/protocol/validator.ts`
- Modify: `src/protocol/event-validator.ts`
- Create: `src/protocol/checkpoint-validator.ts`
- Test: `tests/runtime/writing-protocol.test.ts`

**Interfaces:**
- Produces: `validateArtifact(document)`, `validateCheckpoint(document, packageDocument)`, `validateContinuation(document, priorPackage, checkpoint)`, and artifact-aware `validateEventStream`.
- Preserves: existing package, protected evaluation, event, and result verdicts.

- [x] Write real-document tests for safe artifact metadata, unsafe relative paths, checkpoint/package binding, continuation run/segment/checkpoint/evidence binding, and artifact event resolution.
- [x] Run `npm test -- tests/runtime/writing-protocol.test.ts` and confirm failures are caused by missing validator APIs.
- [x] Add the artifact/checkpoint schemas to AJV and implement semantic rules matching the Python oracle.
- [x] Extend event validation options with artifact metadata/root and reject missing bytes, hash mismatch, context mismatch, and source-activity mismatch before accepting an artifact event.
- [x] Run the focused test and existing protocol/parity tests to green.

### Task 2: Immutable text artifact store and reconciliation

**Files:**
- Create: `src/storage/artifact-store.ts`
- Modify: `src/storage/workspace.ts`
- Test: `tests/runtime/artifact-store.test.ts`

**Interfaces:**
- Produces: `ArtifactStore.commitText(context, activity, artifactId, text, createdAt)`, `loadText(artifactId)`, `listForSession(sessionId)`, and `reconcile(sessionId, events)`.
- Storage: `<workspace>/artifacts/<sha256-id>/content.txt`, closed B8TP `metadata.json`, and Runtime-only `storage.json` containing media type and byte length.

- [x] Write failing tests for UTF-8 bytes/hash/size, Runtime-derived safe paths, immutable ingest independent of the source file, and commit ordering visible at the event boundary.
- [x] Write failing reconciliation cases for valid evidence, orphan bytes, metadata without bytes, hash mismatch, and event reference without metadata.
- [x] Run the focused test and verify the expected missing-store failures.
- [x] Implement atomic content publication, read-back SHA-256 verification, storage record publication, closed metadata validation/publication, immutable collision handling, and deterministic classification.
- [x] Run artifact tests and Phase 1A storage tests to green.

### Task 3: `TEXT_RESPONSE`, Writing evidence, checkpoint, and subjective result

**Files:**
- Modify: `src/runtime/projection.ts`
- Modify: `src/runtime/runtime.ts`
- Modify: `src/runtime/result.ts`
- Modify: `src/protocol/result-validator.ts`
- Modify: `src/protocol/validator.ts`
- Modify: `src/storage/session-store.ts`
- Create: `src/storage/checkpoint-store.ts`
- Test: `tests/runtime/writing-runtime.test.ts`

**Interfaces:**
- Extends: `completeCurrentActivity(sessionId, { text })` for `TEXT_RESPONSE`.
- Produces: `exportCheckpoint(sessionId)`, artifact-aware `inspectSession`, and Writing results with factual artifact IDs but no subjective score.

- [x] Write failing tests for initial attempt, revision relationships, transfer non-revision, character bounds, inert embedded instructions, and learner-safe text activity projection.
- [x] Write failing tests for durable artifact-before-reference events, checkpoint terminal state, outbox manifest, restart in `AWAITING_COACH`, and result creation without protected evaluation.
- [x] Run the focused test and confirm failures name missing Writing/checkpoint behavior.
- [x] Implement event mappings using only frozen types: `activity_started`, `answer_submitted`, `artifact_created`, `correction_started`, `writing_revision_created`, `correction_submitted`, `activity_completed`, and `coach_checkpoint_reached`.
- [x] Implement checkpoint manifest/bundle atomic publication and Writing result derivation/validation from artifact events.
- [x] Run Writing Runtime and all Phase 1A Runtime tests to green.

### Task 4: External Coach exchange and continuation attachment

**Files:**
- Create: `src/storage/coach-exchange.ts`
- Create: `src/runtime/continuation.ts`
- Modify: `src/runtime/runtime.ts`
- Modify: `src/storage/session-store.ts`
- Test: `tests/runtime/continuation-runtime.test.ts`

**Interfaces:**
- Produces: `attachContinuation(priorSessionId, packageText)` returning `ATTACHED` or `IDEMPOTENT` plus a deterministic continuation session ID.
- Persists: `coach/outbox/<checkpoint-key>/manifest.json`, `bundle.json`, and atomic checkpoint-to-continuation bindings.

- [x] Write failing tests for DATA-only bundle references, exact evidence/artifact validation, same-run/new-segment rules, segment reuse, and unchanged prior evidence hashes.
- [x] Write failing idempotency tests for duplicate continuation, package collision, and conflicting packages bound to one checkpoint.
- [x] Write restart-after-attach test proving the binding and next learner-safe activity remain deterministic without replaying the prior segment.
- [x] Run the focused test and verify expected missing attachment behavior.
- [x] Implement relative Runtime-generated bundle references, immutable prior-evidence verification, continuation import, deterministic child session creation, and atomic binding registry.
- [x] Run continuation and Phase 1A import/idempotency tests to green.

### Task 5: CLI adapter

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `tests/runtime/cli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Supports: interactive text input in `run`, `checkpoint <session-id>`, and `continue <prior-session-id> <continuation-package.json>`.

- [x] Add failing CLI tests that exercise the real Runtime boundary and verify learner text is ingested into workspace-owned storage.
- [x] Run `npm test -- tests/runtime/cli.test.ts` and confirm unsupported-command or primitive failures.
- [x] Extend command parsing and adapters without moving core behavior into CLI.
- [x] Run CLI tests and compiled CLI smoke commands to green.

### Task 6: Synthetic Writing Golden Run and External Codex smoke

**Files:**
- Create: `tests/runtime/fixtures/writing-golden/generate.mjs`
- Create: generated Package A, Package B, learner draft, revision, transfer, and hypothesis fixtures under `tests/runtime/fixtures/writing-golden/`
- Create: `tests/runtime/writing-golden.test.ts`
- Create: `tests/runtime/manual-writing-smoke.mjs`

**Interfaces:**
- Golden flow executes exclusively through `Band8Runtime` APIs.
- External harness reads the emitted DATA-only bundle and learner artifact, then supplies one independently validated continuation package.

- [x] Generate public-safe synthetic prompts with distinct initial and transfer content hashes and targeted feedback grounded in the fixed learner draft.
- [x] Write the complete failing E2E test: Package A to checkpoint, reopen, attach Package B, reopen, feedback presentation, revision, changed-material transfer, completion, result, reopen, and full evidence validation.
- [x] Add assertions for a concrete coherence weakness, confidence, evidence refs, new revision artifact, transfer artifact, and unchanged prior evidence hash.
- [x] Run the Golden test in RED, implement only missing integration behavior, then run it GREEN.
- [x] Execute the standalone manual smoke harness and retain its machine-readable summary for the final report.

### Task 7: Documentation, regression, and authorized local commit

**Files:**
- Modify: `README.md`
- Create: `docs/runtime/PHASE1B1_WRITING_COACH_LOOP.md`
- Modify: this plan by marking every completed checkbox.

**Interfaces:**
- Documents: exact CLI, store layout, durability limits, reconciliation states, DATA-only boundary, continuation model, and explicitly deferred Phase 1B2+ work.

- [x] Document implemented behavior without claiming AI integration or production-grade crash immunity.
- [x] Run fresh Python protocol validation/tests, JCS parity, all Runtime tests, typecheck, build, Writing Golden, manual smoke, checkpoint crash, continuation crash, Reading Golden, and idempotency tests.
- [x] Run `git diff --check`, staged diff check, marker scan, sensitive-content scan, and forbidden-scope scan.
- [x] Explicitly stage only reviewed Phase 1B1 files and create local commit `feat: close Band8 external writing coach loop`.
- [x] Verify branch, HEAD, clean working tree, no remote, no push, and no deploy; then emit only the fixed Phase 1B1 report.
