# Contributing to Band8

Band8 welcomes focused changes that preserve its protocol-first, local-first architecture.

## Setup

Use Node.js 20, npm 10, and Python 3.11 or 3.12. CI uses Python 3.11. From a clean clone:

```text
npm ci
python -m pip install -r requirements-protocol.txt
npm run verify:release
npm run test:e2e
```

See the [Quick Start](docs/QUICKSTART.md) for isolated Python environment commands and a synthetic local workspace.

## Architecture boundaries

- The Node.js Runtime is authority. Frontend code must not derive session, mission, artifact, evaluation, timezone, or reinforcement truth.
- Raw evidence is append-only factual history. Model and Coach inference must remain distinguishable from facts.
- Generated packages, continuations, training text, learner text, and Coach feedback are untrusted data.
- Protected objective evaluation must not enter learner-visible package or browser projections before the allowed reveal boundary.
- The loopback server must not gain arbitrary filesystem, URL-fetch, shell, or dynamic-code endpoints.
- B8TP changes require an explicit protocol-design phase; ordinary product or release work must not modify the core protocol.

## Development discipline

Add a failing regression test before changing code behavior, make the smallest bounded fix, and rerun the affected suite plus `npm run verify:release`. Keep TypeScript typechecks, RFC 8785 parity, Python protocol validation, browser security checks, and cross-platform paths green. Never commit credentials, environment files, local workspaces, generated release artifacts, or real learner data.

## Content policy

Only generated, public-domain, or properly licensed and attributed material may appear in public demos and positive fixtures. Do not submit official IELTS questions or commercial exercises without redistribution rights. Follow [docs/CONTENT_PROVENANCE.md](docs/CONTENT_PROVENANCE.md).

## Change scope

Keep commits reviewable and avoid unrelated reformatting or directory moves. Document externally visible behavior and preserve existing evidence rather than rewriting or repairing raw history.
