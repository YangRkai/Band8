# Phase 1A Runtime

## Boundary

Phase 1A is a headless, local Node.js/TypeScript Runtime Kernel. It has no UI framework, AI or Coach client, network service, reinforcement engine, account system, telemetry, database server, or deployment surface.

Generated training packages are untrusted input. The Runtime strictly parses JSON, applies Draft 2020-12 structural validation and Band8 semantic validation, and never executes package content as code or resolves package-provided filesystem paths.

## Install and build

Use Node.js 20 or later and npm. Install the locked development environment, then build:

```text
npm ci
npm run build
```

The built CLI entry point is `dist/src/cli/index.js`.

## Commands

Validate a package and its protected evaluation:

```text
node dist/src/cli/index.js --workspace <workspace> validate <training-package.json> --protected <protected-evaluation.json>
```

Import the validated documents into a local Runtime workspace:

```text
node dist/src/cli/index.js --workspace <workspace> import <training-package.json> --protected <protected-evaluation.json>
```

Run an imported package through the terminal harness:

```text
node dist/src/cli/index.js --workspace <workspace> run <package-id> --session <session-id>
```

The harness displays learner-safe activities, accepts objective selections, and delegates all state, event, evaluation, and result behavior to the Runtime API.

## Workspace

The caller supplies the workspace path. Runtime-owned data stays under these subdirectories:

- `packages/`: immutable canonical package documents.
- `protected/`: evaluator-only protected documents.
- `sessions/`: session metadata, append-only NDJSON evidence, and derived results.
- `artifacts/`: reserved storage boundary; Reading Phase 1A does not implement artifact persistence.
- `registry/`: durable package identity registry.

Identifiers are converted to SHA-256 storage keys; untrusted identifiers are never treated as paths.

## Durability and recovery

Package documents, registry metadata, session metadata, and results use a temporary file, file flush, close, and rename publication sequence. Event records are canonical single-line JSON appended to NDJSON and flushed before the append returns. A partial final event line is rejected and is never accepted as evidence.

These are minimum local durability measures. They do not claim immunity from operating-system, filesystem, hardware, or power-loss behavior beyond the operations actually performed.

A contiguous non-terminal event stream is `VALID_INCOMPLETE`. Resume uses a stable `resume_operation_id`; replaying the same operation is a no-op. Terminal evidence without a result is `REBUILD_REQUIRED`. Results are deterministic projections of authoritative events plus protected evaluation. Invalid raw evidence quarantines the session and is never rewritten automatically.

## Protected evaluation

Protected evaluation is loaded only through the evaluator boundary. Learner projection is constructed from an explicit safe shape and contains no correct response, scoring rule, integrity binding, internal path, or Coach-only data. Derived objective outcomes may appear in the final result; protected scoring material does not.

## Verification

```text
npm test
npm run typecheck
npm run build
npm run test:golden
npm run test:crash
npm run test:idempotency
python tests/protocol/validate_protocol.py all .
python -m unittest discover -s tests -p "test*.py" -v
```
