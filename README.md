# Band8

Band8 is a local-first IELTS training runtime that separates an external AI Coach from the software that executes training and records learning evidence.

`v0.1.0-alpha.1` is a source release candidate for developers and early local testing. It is not a complete IELTS product and does not estimate or guarantee an exam score.

## Why Band8 exists

Personalized training needs two different kinds of authority:

- the external Coach diagnoses evidence and compiles personalized training;
- the Runtime validates packages, executes sessions, persists artifacts, and records factual evidence;
- reinforcement recognizes validated progress rather than time spent or repeated app use.

The Coach is not Runtime authority, and model inference is never stored as if it were a raw fact.

## Architecture

```text
External AI Coach
       │
       │ B8TP
       ▼
Band8 Runtime
       │
       ├── Training sessions
       ├── Evidence and artifacts
       ├── Coach checkpoint exchange
       ├── Reinforcement projections
       └── Loopback Local Web Shell
```

Generated training packages are untrusted input. The Node.js Runtime owns validation, session state, protected evaluation, artifact identity, mission state, learning-day identity, and reinforcement decisions. The React browser shell renders learner-safe `/api/v1/` projections and sends user actions back to that authority.

Start with the [architecture overview](docs/architecture/BAND8_ARCHITECTURE.md) and [trust boundaries](docs/architecture/TRUST_BOUNDARIES.md).

## What works today

`v0.1.0-alpha.1` includes:

- B8TP 0.1 and the External Coach contract;
- a Node.js/TypeScript Runtime with RFC 8785 canonical package identity;
- append-only evidence, package idempotency, and crash/restart recovery;
- protected objective evaluation for Reading `INSTRUCTION`, `PRESENT_TEXT`, and `SELECT` activities;
- Writing `TEXT_RESPONSE`, authoritative artifact persistence, and checkpoint/continuation exchange;
- portable, explicit Coach bundle export;
- evidence-driven Mission, effective Streak, Retention, Transfer, and Pattern Broken projections;
- IANA learning timezone settings with immutable timezone epochs;
- a loopback React/Vite Web Shell with Today, Train, Progress, History, and Coach surfaces.

Protocol navigation: [B8TP](protocol/B8TP.md), [Coach Contract](protocol/COACH_CONTRACT.md), [Pedagogy](protocol/PEDAGOGY.md), [Evidence Contract](protocol/EVIDENCE_CONTRACT.md), [Reinforcement Contract](protocol/REINFORCEMENT_CONTRACT.md), and [versioning](protocol/VERSIONING.md).

## Quick start

Requirements: Node.js 20, npm 10, Python 3.11 or 3.12, and a Chromium-family browser for browser tests. CI uses Python 3.11; the local Linux clean-clone gate also covers Python 3.12.

```text
npm ci
python -m pip install -r requirements-protocol.txt
npm run verify:release
npm run test:e2e
```

Build and start a local synthetic workspace:

```text
npm run build
node dist/src/cli/index.js --workspace .tmp/band8-quickstart timezone set UTC
node dist/src/cli/index.js --workspace .tmp/band8-quickstart import tests/runtime/fixtures/reading-golden/training-package.json --protected tests/runtime/fixtures/reading-golden/protected-evaluation.json
node dist/src/cli/index.js --workspace .tmp/band8-quickstart serve
```

The server binds only to `127.0.0.1`, selects a free port, and opens the local page. Use `--no-open` to suppress browser opening. See the tested [Quick Start](docs/QUICKSTART.md) for clean-clone setup and platform-specific Python environment commands.

## External Coach workflow

Band8 does not call an automatic Coach service. A Writing checkpoint exports a data-only bundle through the Runtime. The user gives that bundle to an external Coach, then explicitly imports a continuation package. The Runtime validates package identity, checkpoint binding, evidence binding, and provenance before training resumes. See the [Writing Coach loop](docs/runtime/PHASE1B1_WRITING_COACH_LOOP.md).

## Evidence and reinforcement

Raw evidence is immutable factual history. Coach hypotheses remain labeled inference with confidence and evidence references. Reinforcement consumes Runtime evidence and can expose mission advancement, retention, transfer, pattern status, and effective learning days; it does not award XP for usage. See the [data flow](docs/architecture/DATA_FLOW.md) and [reinforcement design](docs/runtime/PHASE1C_REINFORCEMENT_ENGINE.md).

## Current limitations

This alpha does not include Speaking/audio, transcription, an automatic Codex or API Coach, calibrated IELTS score estimation, cloud sync, a native mobile app, Electron/Tauri packaging, a browser-only PWA Runtime, or official IELTS scoring.

## Privacy and security

Runtime learning data stays in the user-selected local workspace unless the user explicitly exports a Coach bundle. Data is stored as JSON, NDJSON, and plain artifacts. The local server has no analytics or telemetry SaaS, does not fetch external assets, and is not designed for LAN or Internet exposure. It exposes no arbitrary shell, path-read, or URL-fetch API. See [SECURITY.md](SECURITY.md) and the [Phase 1D security model](docs/runtime/PHASE1D_LOCAL_WEB_SHELL.md).

## Development

```text
npm ci
python -m pip install -r requirements-protocol.txt
npm run verify:release
npm run test:e2e
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing Runtime boundaries or public fixtures. Content redistribution rules are in [docs/CONTENT_PROVENANCE.md](docs/CONTENT_PROVENANCE.md). Release history is in [CHANGELOG.md](CHANGELOG.md), with notes for this alpha in [docs/releases/v0.1.0-alpha.1.md](docs/releases/v0.1.0-alpha.1.md).

## Roadmap

The next step after local review is public-release configuration and hosted CI evidence. Product capabilities deferred from this alpha remain deferred until their contracts and evidence boundaries are designed and validated.

## License and trademark

Band8 source is licensed under the [Apache License 2.0](LICENSE).

Band8 is an independent open-source project and is not affiliated with, endorsed by, or sponsored by IELTS or its respective owners. IELTS is a trademark of its respective owners.
