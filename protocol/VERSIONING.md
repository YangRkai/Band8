# Protocol Versioning

## Versions

B8TP, schemas, pedagogy, Coach contract, skill taxonomy, reinforcement contract, and evidence contract use semantic versions. Phase 0 freezes all at `0.1.0`.

- Patch: clarification or stricter validation that does not change valid document meaning.
- Minor: additive backward-compatible field, primitive, event, or skill.
- Major: incompatible structure, meaning, security policy, or lifecycle behavior.

## Compatibility

V0.1 accepts only exact protocol and schema version `0.1.0`. Unknown versions are rejected deterministically. A future migration produces new records, records `migration_version`, preserves original bytes, and never silently rewrites evidence.

## Identity and replay

Package IDs, session IDs, event IDs, artifact IDs, hypothesis IDs, and review IDs are immutable. Duplicate package IDs are rejected. Accepted packages record all contract versions so a session can be replayed under the rules that produced it.

## Schema policy

Schemas use JSON Schema Draft 2020-12, explicit required fields, bounded arrays and strings, and closed object boundaries. Semantic validation adds reference integrity, event order, assessment restrictions, path safety, dangerous-content rejection, and collision handling.
