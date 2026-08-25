# Band8 Trust Boundaries

## Boundaries

| Boundary | Untrusted input | Required control | Failure result |
| --- | --- | --- | --- |
| Coach to import gate | Entire training package | Size limit, JSON parse, schema, semantic checks, primitive whitelist | Reject package |
| Package to renderer | Text and resource data | Plain text or restricted Markdown only; no active content | Reject package |
| Package to filesystem | Artifact and resource references | Normalized relative path only; no traversal, drive, UNC, URI, or symlink authority | Reject package |
| Runtime to evidence store | Runtime events and artifacts | Sequence, identity, hash, append-only write | Reject new record and log failure |
| Evidence to Coach | Facts and prior model inference | Explicit record kind and provenance | Preserve distinction in output |
| Reinforcement to learning truth | Reward eligibility and presentation | One-way read from evidence; no write authority | Deny update |

## Import limits

- Package size: 1 MiB.
- Maximum JSON depth: 16.
- Maximum activities: 64.
- Maximum phases: 16.
- Maximum resources: 64.
- Maximum text field: 12,000 Unicode code points.
- Unknown fields: rejected where a schema defines an object boundary.
- External resources: disallowed in V0.1 packages; content is embedded or references a package-local resource ID.
- Executable content: HTML, JavaScript schemes, script blocks, shell commands, and executable file references are rejected.

## Non-capabilities

A package cannot define UI components, CSS, JavaScript, executable code, shell commands, host paths, network calls, arbitrary URLs, local file reads, or reward animations. It can select only fixed primitives and request only enumerated reinforcement candidates. Runtime policy decides presentation.

## Data safety

Raw evidence is append-only. Corrections and migrations are additional records with provenance. Secrets are never protocol fields. Export excludes runtime secrets and includes all learner-owned protocol data.
