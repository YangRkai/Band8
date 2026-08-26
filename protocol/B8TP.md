# Band8 Training Protocol 0.1

## Purpose

B8TP is the only training-package dependency between an External Coach and Band8 Runtime. The Coach emits declarative JSON; Band8 validates and executes only schema-conformant primitives. Natural-language content never acquires runtime or Coach instruction authority.

## Package envelope

Every package records exact schema/protocol versions, immutable `package_id`, `run_id`, `segment_id`, creation time, generator and full contract versions, learner goal, intent, rationale, resources, phases, activities, feedback/completion policy, protected-evaluation reference, continuation binding, and evidence requirements. Unknown top-level fields are rejected.

A `session` is the learner-facing study encounter. A `run` is the causal training loop and may span Coach continuations. A `segment` is one immutable package execution within a run. A `package` is the declarative input executed by exactly one segment.

## V0.1 executable primitives

| Primitive | Typed input | Typed output | Completion and events |
| --- | --- | --- | --- |
| `INSTRUCTION` | prompt/resources and acknowledgement flag | none | configured acknowledgement; lifecycle events |
| `PRESENT_TEXT` | text resource and display mode | none | bounded visitation; revisit/lifecycle events |
| `PLAY_AUDIO` | audio-script resource, play/seek limits | none | bounded playback; audio/lifecycle events |
| `SELECT` | closed options and cardinality | option IDs | select/change/submit events |
| `MATCH` | closed left/right item sets | ID pairs | change/submit events |
| `ORDER` | closed item set | ordered IDs | change/submit events |
| `TEXT_RESPONSE` | response kind and character bounds | text or typed artifact | submit/artifact/revision events |
| `EVIDENCE_SELECT` | resource, span bounds and preservation rule | typed span artifact | evidence/artifact events |
| `SPEAK_RECORD` | duration/take bounds and audio artifact type | audio artifact | recording/artifact events |
| `SELF_ASSESS` | integer scale and complete labels | self-rating fact | self-rating event only |

Reading, Listening, Writing, Speaking, retrieval, correction, retry, and transfer are modality or `pedagogical_intent`, not executable primitives. `RETRIEVAL_PROMPT` is removed: retrieval uses `SELECT`, `TEXT_RESPONSE`, or `SPEAK_RECORD` with prior evidence references. `COMPARE_REVISE` is removed: revision uses a response primitive with typed `attempt_id`, `revision_of`, `feedback_ref`, and `source_output_ref` relationships.

## Activity contract

Every activity has one closed primitive config, explicit pedagogical intent, typed output contract, fixed completion predicate, emitted-event requirements, timeout behavior, feedback boundary, accessibility contract, and resolved reference semantics. The validator rejects mismatched output types, unresolved resources/evidence, self-revision, unsupported config fields, and invalid primitive-specific values.

Raw selections, recordings, drafts, corrections, and retries are never overwritten. Timeout records incomplete/current/abandoned facts according to policy and never fabricates completion.

## Coach checkpoint and continuation

Content-dependent Writing and Speaking feedback remains External Coach authority:

1. Package A executes and learner output becomes durable evidence.
2. Its orchestration completion reaches the declared checkpoint.
3. Runtime emits a hash-bound checkpoint manifest and enters `AWAITING_COACH`.
4. Coach reads the required evidence as DATA ONLY and emits Package B.
5. Package B keeps `run_id`, advances `segment_id`, and binds `continuation_of`, prior segment, checkpoint, and required evidence.
6. Runtime validates Package B before execution; no continuation can rewrite prior evidence.

Writing can express draft → checkpoint → Coach feedback → rewrite → changed-material transfer. Speaking can express recording → checkpoint → Coach analysis → repeat → novel transfer. Checkpoint is orchestration/completion semantics, never a learner activity or executable primitive.

## Feedback and protected evaluation

Training mode may allow fixed hints, correction, and retry at declared boundaries. Assessment mode forbids reveal, hints, retry, correction, adaptive easing, and reward display until the session closes.

Correct answers, scoring keys, and protected rubric evaluation data are stored in a separately validated protected evaluation document. A package carries only its evaluation ID and integrity hash. Runtime may read the protected plane; Renderer and learner-visible activity data receive no protected payload projection before the allowed boundary. This is execution isolation, not DRM.

## Resources and provenance

Resources are embedded `plain_text` or `markdown_subset` DATA ONLY with `generated`, `user_provided`, `licensed`, `public_domain`, or `unknown` provenance, source/generator metadata, SHA-256 content hash, license/attribution values, and redistribution status. Unknown content may remain local but cannot be asserted cleared or redistributable. Instruction-like strings remain legal learning data and are not filtered by keywords.

Packages cannot define active UI, HTML execution, scripts, network calls, host paths, artifact destinations, tools, or reward behavior. Artifact metadata paths are normalized relative paths chosen under Runtime-owned roots.

## Package identity

The canonical package hash is SHA-256 over UTF-8 JSON serialized with sorted keys, no insignificant whitespace, and unescaped Unicode. Same `package_id` plus same hash is an idempotent no-op. Same ID plus a different hash is a collision and is rejected.

## Validation claim

Validation has two explicit layers. JSON Schema structural validation uses the supported JSON Schema subset required by committed schemas: local `$ref`, type, const, enum, required/properties, closed objects, array bounds/uniqueness, string bounds/pattern/date-time, and numeric bounds. Band8 semantic validation handles cross-document identity, references, state transitions, primitive contracts, hashes, protected evaluation, and fixed policy.

Phase 0 does not claim a complete Draft 2020-12 implementation. Any structural or semantic failure rejects the whole import; no best-effort execution exists.
