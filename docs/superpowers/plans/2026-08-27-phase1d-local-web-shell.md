# Band8 Phase 1D Local Web Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Runtime-authoritative learning-timezone model and a secure, daily-usable localhost Band8 web shell.

**Architecture:** Runtime persists timezone epochs and stable learning-day records, then exposes learner-safe product projections. A loopback-only Node HTTP adapter transports those projections to a small React/Vite shell without duplicating learning logic.

**Tech Stack:** Node.js 20 built-in HTTP, TypeScript 5.7, React, React DOM, Vite, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-phase1d-local-web-shell-design.md`

## Global Constraints

- Work only in the Band8 repository on `feature/phase1d-local-web-shell` with base `8dad87b34eb0e60d5944f0a1b3d6288e4adc0591` in history.
- Do not change B8TP schemas or raw evidence.
- Runtime is the only authority for state, evaluation, artifacts, continuation, mission, streak, reveal, and qualification.
- Bind only `127.0.0.1`; never add wildcard CORS, arbitrary path, URL fetch, shell, dynamic code, telemetry, or remote assets.
- Create exactly the requested local commits; push and deploy remain `NO`.

---

### Task 1: Persist learning timezone epochs

**Files:**
- Create: `src/storage/learning-timezone-store.ts`
- Modify: `src/storage/workspace.ts`
- Test: `tests/runtime/learning-timezone.test.ts`

**Interfaces:**
- Produces: `LearningTimezoneStore.read()`, `configure(timeZone)`, `change(timeZone)`, `epochFor(timestamp)`, `assignLearningDay(session)`.
- Produces: `LearningTimezoneSettings`, `LearningTimezoneEpoch`, and `LearningDayRecord` closed DTOs.

- [ ] Write tests with injected timestamps and epoch IDs for valid Shanghai/Los Angeles identifiers, invalid offsets/identifiers, append-only epoch changes, immutable assignments, and restart persistence.
- [ ] Run `npx vitest run tests/runtime/learning-timezone.test.ts` and confirm failures are caused by the missing store.
- [ ] Implement strict timezone validation, atomic settings persistence, and immutable per-session assignment.
- [ ] Re-run the focused test and keep it green while removing duplication.

### Task 2: Project epoch-aware effective streaks

**Files:**
- Modify: `src/reinforcement/time.ts`
- Modify: `src/reinforcement/streak.ts`
- Modify: `src/reinforcement/policy.ts`
- Modify: `src/reinforcement/engine.ts`
- Modify: `src/runtime/runtime.ts`
- Test: `tests/runtime/learning-timezone.test.ts`
- Test: `tests/runtime/reinforcement-mission-streak.test.ts`
- Test: `tests/runtime/reinforcement-runtime.test.ts`

**Interfaces:**
- Consumes: immutable `LearningDayRecord[]` and the current `LearningTimezoneEpoch`.
- Produces: `EffectiveStreakProjection` with stable day identities, current epoch, best streak, current streak, and total days.

- [ ] Add literal boundary cases for UTC/local-date divergence, same local date across UTC dates, epoch reset, historical preservation, and duplicate session counting.
- [ ] Run the focused timezone and reinforcement tests and confirm expected UTC-assumption failures.
- [ ] Materialize qualifying learning days in `ReinforcementEngine`, pass identities into policy, and calculate current streak only within the current epoch.
- [ ] Re-run reinforcement and timezone suites until green; update Phase 1C documentation to describe the new Runtime policy.

### Task 3: Verify and commit 1D-A

**Files:**
- Modify: `README.md`
- Modify: `docs/runtime/PHASE1C_REINFORCEMENT_ENGINE.md`

**Interfaces:**
- Produces: local commit `fix: anchor effective days to learning timezone`.

- [ ] Run timezone, reinforcement, Phase 1C, typecheck, build, and `git diff --check` fresh.
- [ ] Review that raw evidence hashes are unchanged and settings are Runtime-owned.
- [ ] Stage only 1D-A files plus approved design/plan docs and create the specified local commit.

### Task 4: Build the secure local HTTP adapter

**Files:**
- Create: `src/server/errors.ts`
- Create: `src/server/body.ts`
- Create: `src/server/security.ts`
- Create: `src/server/dto.ts`
- Create: `src/server/server.ts`
- Modify: `src/runtime/runtime.ts`
- Modify: `src/cli/index.ts`
- Test: `tests/server/local-server.test.ts`
- Test: `tests/server/security.test.ts`

**Interfaces:**
- Produces: `startBand8Server({repositoryRoot, workspacePath, port, openBrowser})` and `/api/v1/` JSON contracts.
- Consumes: public Runtime commands and learner-safe Runtime projections only.

- [ ] Write real HTTP tests for loopback/auto-port, entry token, exact Origin and Host, stale/wrong token, JSON content type, payload limits, stable errors, no CORS, and no path/URL/shell routes.
- [ ] Run focused server tests and confirm missing server failures.
- [ ] Implement the built-in HTTP server, security policy, stable errors, and CLI `serve` parsing with `--port` and `--no-open`.
- [ ] Re-run focused server tests and typecheck until green.

### Task 5: Add Runtime product projections and transport routes

**Files:**
- Create: `src/runtime/product-projection.ts`
- Modify: `src/runtime/runtime.ts`
- Modify: `src/server/dto.ts`
- Modify: `src/server/server.ts`
- Test: `tests/runtime/product-projection.test.ts`
- Test: `tests/server/product-api.test.ts`

**Interfaces:**
- Produces: `runtime.today()`, `runtime.training()`, `runtime.coachStatus()`, `runtime.progress()`, and `runtime.history({limit,cursor})`.
- Produces: mutation routes for timezone, package import, session start/activity submit, Coach export, and continuation import.

- [ ] Write Runtime and actual HTTP payload tests that assert factual empty/current states and absence of protected answers, scoring keys, private paths, and tokens.
- [ ] Run focused tests and confirm missing projection/route failures.
- [ ] Implement projections from existing stores and Runtime commands, including idempotent current-session recovery and paginated History.
- [ ] Re-run focused tests and all Runtime regressions until green.

### Task 6: Create the React/Vite product shell

**Files:**
- Create: `web/index.html`
- Create: `web/src/main.tsx`
- Create: `web/src/api.ts`
- Create: `web/src/app.tsx`
- Create: `web/src/styles.css`
- Create: `web/vite.config.ts`
- Create: `web/tsconfig.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`

**Interfaces:**
- Consumes: `/api/v1/` safe DTOs and the bootstrap session token.
- Produces: responsive Today, Train, Progress, History, Coach, and Settings routes.

- [ ] Add component tests for empty Today, mission hierarchy, all four Runtime primitives, unsupported primitive error, writing word count, Coach status, reveal, and inert untrusted text.
- [ ] Run frontend tests and confirm missing application failures.
- [ ] Install only React, React DOM, Vite, and necessary type packages; implement thin API calls and semantic React views with no raw HTML.
- [ ] Re-run frontend tests, typecheck, and build until green.

### Task 7: Add browser fixtures and Playwright E2E

**Files:**
- Create: `tests/e2e/fixtures/dogfood-workspace.ts`
- Create: `tests/e2e/fixtures/reading-package.json`
- Create: `tests/e2e/fixtures/reading-protected-evaluation.json`
- Create: `tests/e2e/fixtures/writing-package-a.json`
- Create: `tests/e2e/fixtures/writing-package-b.json`
- Create: `tests/e2e/band8.spec.ts`
- Create: `playwright.config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `npm run test:e2e` against an actual `band8 serve` process and synthetic public fixtures.

- [ ] Write browser scenarios for first run, timezone setup/change, Today, Reading, pre-submit answer leakage, reveal, Writing checkpoint, Coach export/import, revision, Progress, History, refresh/restart, XSS, prompt injection, CSRF/Origin, and 375/768/1440 widths.
- [ ] Run E2E and confirm failures identify missing UI flows before completing each flow.
- [ ] Complete minimal fixture/bootstrap support and UI behavior through the real HTTP path.
- [ ] Re-run E2E until every scenario is green without screenshot brittleness.

### Task 8: Dogfood, audit, regress, and commit 1D-B

**Files:**
- Modify: `README.md`
- Modify: product/server files only when dogfood exposes a tested defect.

**Interfaces:**
- Produces: local commit `feat: add Band8 local web shell` and the fixed completion report evidence.

- [ ] Run the Reading and Writing flows with real Playwright browser interactions, stop/restart the server, and capture mission/reveal/evidence observations.
- [ ] Audit frontend symbols and semantics for duplicated Runtime domain logic; audit secrets, private keys, unfinished markers, external URLs, arbitrary path/URL/shell surfaces, and horizontal overflow.
- [ ] Run every required protocol, parity, Runtime, timezone, server, frontend, E2E, typecheck, build, and diff command fresh.
- [ ] Stage all 1D-B files, create the specified local commit, verify clean working tree, and report `push: NO`, `deploy: NO`.
