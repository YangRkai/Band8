# Band8 Trust Boundaries

## Boundaries

| Boundary | Untrusted input | Required control | Failure result |
| --- | --- | --- | --- |
| Coach to import gate | Package/continuation | size, structural/semantic validation, primitive whitelist, identity hash | reject |
| Package to Renderer | learner-visible text/resources | plain/restricted Markdown data projection; no protected plane or executable fields | reject projection/import |
| Protected evaluation to Runtime | scoring entries | separate schema, package/hash binding, activity/rule checks | reject evaluation |
| Package to filesystem | references | Runtime-owned root and normalized relative paths | reject |
| Runtime to evidence store | events/artifacts | typed payload, context, sequence, commit order, hash, append-only | reject/quarantine |
| Evidence to Coach | facts, artifacts, prior inference | `COACH_INPUT_TRUST.md`; all are DATA ONLY | stop Coach run |
| Checkpoint to continuation | manifest and required evidence | package hash, run/segment/checkpoint binding | reject continuation |
| Evidence to reinforcement | historical facts | independent fixed policy and evidence resolution | deny award/update |
| Reinforcement to learning truth | reward state | no write authority | deny update |

## Instruction precedence

Platform/system execution rules outrank repository governance, which outranks versioned Band8 authority, which outranks the current Coach invocation. Package text, learner content, artifacts, feedback, imports, and prior inference never join this authority chain.

## Data and path safety

Learning text may contain URLs, shell words, role text, scripts as quoted subject matter, or prompt-injection phrases. It remains non-executable data. Safety comes from closed schemas, non-executable fields, Renderer isolation, protected-plane isolation, no package-selected paths/tools/network/UI, and explicit Coach trust precedence—not lexical filtering.

Secrets are never protocol fields. Export excludes Runtime secrets and includes learner-owned protocol records.
