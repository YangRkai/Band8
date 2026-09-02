# Band8 Phase 1C Evidence-Driven Reinforcement Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, evidence-driven reinforcement projection and frozen `PATTERN_BROKEN 0.1.0` decision pipeline without changing raw evidence, Coach inference, or the B8TP schemas.

**Architecture:** `Band8Runtime` resolves authoritative sessions into normalized reinforcement facts, then a pure policy module computes mission, effective-day/streak, event eligibility, current qualification, and reveal priority. A dedicated store atomically publishes immutable protocol-valid pattern decisions and replaceable current qualification projections under `reinforcement/`, while all other event types remain recomputable Runtime projections with stable JCS-derived semantic identities.

**Tech Stack:** Node.js 20+, TypeScript 5.7, Vitest 2.1, AJV 8, RFC 8785 JCS helpers, filesystem atomic writes.

**Spec:** User-supplied `Band8 Phase 1C — Evidence-Driven Reinforcement Engine` execution specification, approved against commit `5f5ba0917ece45963da36b7d481bb8632a38a2a2`; frozen boundaries in `protocol/REINFORCEMENT_CONTRACT.md` and `protocol/EVIDENCE_CONTRACT.md`.

## Global Constraints

- Work only in the Band8 repository on `feature/phase1c-reinforcement-engine`.
- Do not change any frozen protocol document or schema.
- `PATTERN_BROKEN` is the only event persisted as a B8TP reinforcement decision in protocol version `0.1.0`.
- Coach packages and hypotheses may identify targets, but cannot grant events, thresholds, qualifications, streaks, or mastery.
- Raw events, artifacts, protected evaluation, results, and Coach inference remain unmodified.
- The policy is deterministic, uses injected evaluation time, and never uses random eligibility.
- Twenty-four hours is a minimum delayed-evidence boundary and never a mastery claim.
- No fake IELTS decimal progress, UI framework, AI API, Speaking/audio implementation, network service, push, deploy, or remote creation.
- Every production behavior follows a witnessed RED → minimal GREEN → refactor cycle.

---

### Task 1: Authoritative evidence index and protocol decision validation

**Files:**
- Create: `src/reinforcement/types.ts`
- Create: `src/reinforcement/evidence.ts`
- Modify: `src/protocol/schema-validator.ts`
- Modify: `src/protocol/validator.ts`
- Modify: `src/storage/session-store.ts`
- Test: `tests/runtime/reinforcement-evidence.test.ts`

**Interfaces:**
- Produces `ReinforcementFact`, `AuthoritativeSessionEvidence`, and `collectAuthoritativeEvidence(...)`.
- Produces `ProtocolValidator.validateReinforcementDecision(document)` using the frozen schema plus the exact Phase 0.6 semantic checks.
- Produces `SessionStore.list()` sorted by `session_id`.

- [ ] **Step 1: Write failing tests for authoritative-only collection.** Assert completed Reading evidence is collected; missing results, quarantined sessions, self-ratings, Coach text, and duplicate/replayed session identities do not become successful reinforcement facts.
- [ ] **Step 2: Run `npx vitest run tests/runtime/reinforcement-evidence.test.ts` and verify failures identify missing collection and validation APIs.**
- [ ] **Step 3: Add the closed fact types and collect facts only after `inspectSession(sessionId) === "AUTHORITATIVE"`; resolve objective outcomes to activity skill refs, resource hashes, timestamps, evidence class, hypothesis identity, and correction/transfer intent without synthesizing subjective correctness.**
- [ ] **Step 4: Add reinforcement schema compilation and semantic validation for distinct weakness sessions, intervention ordering, two successful improvements, 86,400-second retrieval, changed hashes, contradiction blocking, supersession, and regression evidence.**
- [ ] **Step 5: Run the focused test and existing protocol validation/parity tests; refactor only after all pass.**

### Task 2: Mission, effective training day, and streak projections

**Files:**
- Create: `src/reinforcement/mission.ts`
- Create: `src/reinforcement/streak.ts`
- Test: `tests/runtime/reinforcement-mission-streak.test.ts`

**Interfaces:**
- Produces `projectMission(packageDocument, session, evidence, currentQualification)` with lifecycle `OPEN | IN_PROGRESS | EVIDENCE_PENDING | VALIDATION_PENDING | CLOSED`.
- Produces `projectEffectiveStreak(authoritativeSessions, evaluatedAt)` returning distinct UTC effective days, current streak, best streak, and total effective days.

- [ ] **Step 1: Write failing table tests for every mission lifecycle state and prove the mission target comes only from package target skills, objective, and hypothesis refs.**
- [ ] **Step 2: Run the focused mission test and verify the intended missing-module failure.**
- [ ] **Step 3: Implement mission projection: imported/ready is `OPEN`, running is `IN_PROGRESS`, legitimate completion without authoritative success is `EVIDENCE_PENDING`, successful evidence awaiting delayed proof is `VALIDATION_PENDING`, and a confirmed current qualification or successful assessment closes the mission.**
- [ ] **Step 4: Write failing streak tests proving login/open activity contributes nothing, same-day qualifying sessions count once, quarantine and replay do not count, gaps end only the current streak, and best/total history remains.**
- [ ] **Step 5: Implement UTC-day policy `0.1.0` using authoritative completed sessions with at least one learner submission and no replay identity; run both focused files until green.**

### Task 3: Deterministic event eligibility, pattern chain, and qualification recomputation

**Files:**
- Create: `src/reinforcement/policy.ts`
- Create: `src/reinforcement/identity.ts`
- Test: `tests/runtime/reinforcement-policy.test.ts`
- Test: `tests/runtime/reinforcement-pattern.test.ts`
- Create: `tests/runtime/fixtures/reinforcement/pattern-chain.json`

**Interfaces:**
- Produces `evaluatePolicy(input): ReinforcementEvaluation` with policy version `0.1.0`.
- Produces `reinforcementIdentity(policyVersion, eventType, sortedEvidenceRefs)` as `reward-` plus a JCS SHA-256 digest prefix.
- Produces protocol-valid historical award and qualification update documents for `PATTERN_BROKEN` only.

- [ ] **Step 1: Write failing event-policy tests for `SESSION_COMPLETE`, `MISSION_ADVANCED`, `TRANSFER_CONFIRMED`, `RETENTION_CONFIRMED`, `STREAK_EXTENDED`, and objective-only `PERSONAL_BEST`, including explicit rejection reasons.**
- [ ] **Step 2: Verify RED, then implement fixed eligibility: valid participation completion; mission state advancement; successful changed-material objective transfer; successful delayed retrieval at least 86,400 seconds; streak day extension; and comparable objective metrics only.**
- [ ] **Step 3: Write the deterministic multi-session fixture and failing pattern tests for two distinct failures, targeted intervention, two later improvements, delayed retrieval, changed-material transfer, and no unresolved assessment contradiction.**
- [ ] **Step 4: Verify RED, then implement the complete ordered `PATTERN_BROKEN 0.1.0` chain and protocol decision creation.**
- [ ] **Step 5: Add failing tests for later contradictory assessment, historical award preservation, current revoked qualification, 24-hour-not-mastery, easy repetition, self-rating, Coach claims, same-resource transfer, and wall-clock anomaly rejection.**
- [ ] **Step 6: Implement current qualification recomputation and stable identities from policy/event/evidence set; run both focused files and protocol tests until green.**

### Task 4: Restart-safe store and Runtime API

**Files:**
- Create: `src/storage/reinforcement-store.ts`
- Create: `src/reinforcement/engine.ts`
- Modify: `src/storage/workspace.ts`
- Modify: `src/runtime/runtime.ts`
- Test: `tests/runtime/reinforcement-runtime.test.ts`

**Interfaces:**
- Produces `ReinforcementStore.publishDecision`, `listDecisions`, `publishQualification`, and `readQualification`.
- Produces `Band8Runtime.evaluateReinforcement(sessionId)`, `reveal(sessionId)`, and `mission(sessionOrRunId)`.

- [ ] **Step 1: Write failing store tests proving immutable decision publication is idempotent for identical JCS content, rejects identity collision, atomically replaces current qualification, and creates only `reinforcement/decisions` plus `reinforcement/qualifications`.**
- [ ] **Step 2: Verify RED, then implement the storage boundary with `writeTextAtomic`, canonical JSON, storage-key paths, and frozen protocol validation before publication.**
- [ ] **Step 3: Write failing Runtime tests proving evaluation is authoritative-only, repeated calls/restart/result rebuild produce identical semantic IDs and no duplicate decision, raw event/result hashes remain unchanged, and quarantine denies publication.**
- [ ] **Step 4: Verify RED, then wire the engine to existing package/session/event/result/artifact stores and the injected `now` source without adding reinforcement events after terminal raw evidence.**
- [ ] **Step 5: Write and pass recomputation tests proving old decisions retain their policy version while the current qualification file reflects later contradiction.**

### Task 5: Reveal priority, CLI, Reading fixture, and Writing dogfood

**Files:**
- Create: `src/reinforcement/reveal.ts`
- Modify: `src/cli/index.ts`
- Modify: `package.json`
- Test: `tests/runtime/reinforcement-reveal.test.ts`
- Modify: `tests/runtime/cli.test.ts`
- Create: `tests/runtime/reinforcement-golden.test.ts`
- Create: `tests/runtime/manual-reinforcement-smoke.mjs`

**Interfaces:**
- Produces a presentation-ready reveal with `primary_event`, `supporting_events`, `evidence_refs`, and `qualification_change`.
- CLI commands are `band8 reinforce evaluate <session-id>`, `band8 reveal <session-id>`, and `band8 mission <session-id-or-run-id>`, with JSON emitted only from Runtime APIs.

- [ ] **Step 1: Write failing reveal tests for priority `PATTERN_BROKEN > RETENTION_CONFIRMED > TRANSFER_CONFIRMED > MISSION_ADVANCED > STREAK_EXTENDED > SESSION_COMPLETE`, stable tie-breaking, and no event toast per click.**
- [ ] **Step 2: Verify RED, then implement one primary event plus ordered supporting events and unioned evidence refs.**
- [ ] **Step 3: Write failing CLI tests for all three commands and verify they call the Runtime projection rather than reimplementing policy.**
- [ ] **Step 4: Implement the CLI grammar and canonical JSON output, then run CLI tests green.**
- [ ] **Step 5: Add a Reading golden reinforcement test for ordinary completion/mission without fabricated pattern break.**
- [ ] **Step 6: Add a deterministic Writing smoke that replays the Phase 1B1 golden loop, evaluates its actual authoritative evidence, prints eligible/rejected/primary/secondary/mission before and after/evidence refs, and rejects subjective transfer confirmation when no authoritative success exists.**
- [ ] **Step 7: Run `npm run smoke:reinforcement` and retain its exact output for the fixed completion report.**

### Task 6: Documentation, full regression, review, and local commit

**Files:**
- Create: `docs/runtime/PHASE1C_REINFORCEMENT_ENGINE.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Documents authority separation, policy `0.1.0`, mission/streak/reveal semantics, persisted paths, CLI, anti-farming limits, and deferred product surfaces.

- [ ] **Step 1: Document that the objective is sustained effective learning behavior, `learning truth > engagement`, and the engine never optimizes session count, active minutes, or daily opens.**
- [ ] **Step 2: Document the exact machine rules and limitations: UTC effective day, subjective Writing transfer rejection, 24 hours not mastery, no fake IELTS decimals, and recovery token deferred because no frozen deterministic policy exists.**
- [ ] **Step 3: Run all focused reinforcement tests, full Vitest, Python protocol tests, parity, Reading Golden, Writing regression, crash/recovery, idempotency, typecheck, build, and the dogfood smoke.**
- [ ] **Step 4: Run `git diff --check`, scan tracked source/docs/tests for forbidden unfinished markers, verify no UI/AI/Speaking/dependency expansion, and inspect every changed file.**
- [ ] **Step 5: Request a code review; address only validated findings with a new failing regression test before each fix, then repeat the complete verification set.**
- [ ] **Step 6: Stage only named Phase 1C files, create local commit `feat: add evidence-driven reinforcement engine`, and verify branch, HEAD, clean working tree, no remote, no push, and no deploy.**
