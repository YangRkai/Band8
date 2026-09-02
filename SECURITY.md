# Security Policy

## Supported version

Security review currently applies to the `0.1.0-alpha.1` source release candidate. This is alpha software intended for local evaluation, not an Internet service.

## Reporting a vulnerability

Before a public repository security channel is configured, do not publish potential credential material, protected evaluation data, or exploit details in a public issue. Use the repository's private security-reporting mechanism once available. Public reporting configuration is deferred until the repository exists in the public-release phase.

Include the affected version, a minimal reproduction, expected impact, and whether the report contains learner data. Never attach real learner workspaces or secrets.

## Local server threat model

The Web Shell follows this boundary:

```text
Browser → loopback HTTP adapter → Node.js Runtime → local workspace
```

The server binds only to `127.0.0.1` and must not be intentionally exposed to a LAN or the Internet. Mutations require exact same-origin checks, JSON or bounded file-upload transport, and a startup-scoped local session token. Server restart invalidates the old token. The adapter applies payload limits and returns safe error DTOs without stack traces, protected answers, secrets, or internal paths.

The startup token prevents a different browser origin from silently mutating Band8. It is not an operating-system authentication boundary: a process already running as the same user may be able to connect to loopback and access that user's workspace. Protect the workstation and workspace with normal operating-system access controls.

The local API provides no arbitrary filesystem read/write, arbitrary URL fetch, shell execution, or dynamic code execution endpoint. Browser content is rendered as escaped text; training packages and learner responses cannot become UI or process authority.

## Data and Coach trust

Generated packages and continuation packages are untrusted and pass strict Runtime validation. Protected objective evaluation remains outside learner-safe projections. Coach bundles are explicit user exports; continuation import is explicitly initiated and bound to the current checkpoint and evidence. External Coach inference remains separate from immutable factual evidence.

Band8 includes no analytics SDK, tracking pixel, telemetry SaaS, cloud sync, or automatic Coach network call. Learning data stays in the selected local workspace unless the user explicitly exports it.

More detail is available in [trust boundaries](docs/architecture/TRUST_BOUNDARIES.md), [Coach input trust](protocol/COACH_INPUT_TRUST.md), and [Phase 1D Local Web Shell](docs/runtime/PHASE1D_LOCAL_WEB_SHELL.md).
