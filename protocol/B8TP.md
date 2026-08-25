# Band8 Training Protocol 0.1

## Purpose

B8TP is the only training-package dependency between an External Coach and Band8 Runtime. The Coach emits JSON; Band8 validates and executes only schema-conformant primitives. Natural-language instructions never acquire runtime authority.

## Package envelope

Every package contains:

- `schema_version` and `protocol_version`, both `0.1.0`.
- globally stable `package_id` and RFC 3339 `created_at`.
- `generator` provenance and `contract_versions`.
- IELTS `learner_goal`, `session_intent`, and bounded duration.
- traceable `training_rationale`, target skills, tested hypotheses, and available evidence references.
- package-local resources, ordered phases, and activities.
- fixed feedback, completion, reinforcement-hint, and evidence policies.

The schema rejects unknown top-level fields. Package IDs are immutable and collision-intolerant. Runtime stores the accepted package with its session.

## V0.1 training primitives

| Primitive | Role | Required result | Characteristic events |
| --- | --- | --- | --- |
| `INSTRUCTION` | Present directions without collecting assessed content | acknowledgement when required | activity start/complete |
| `PRESENT_TEXT` | Present a reading passage, prompt, rubric excerpt, or comparison text | visitation facts | text revisited, activity complete |
| `PLAY_AUDIO` | Play a package-local audio script through runtime-controlled media | play count and position facts | audio start/pause/replay |
| `SELECT` | One or multiple choice from bounded options | selected option IDs and revisions | answer selected/changed/submitted |
| `MATCH` | Map bounded left items to right items | submitted pairs | answer changed/submitted |
| `ORDER` | Arrange bounded items | submitted item order | answer changed/submitted |
| `TEXT_RESPONSE` | Short answer, long answer, explanation, recall, or essay | text artifact or submitted value | answer submitted, writing revision created |
| `EVIDENCE_SELECT` | Select and optionally annotate bounded spans in a resource | immutable original spans plus submitted revision | evidence selected/changed |
| `SPEAK_RECORD` | Capture a bounded speaking attempt | audio artifact and optional transcript artifact | speaking recording created |
| `COMPARE_REVISE` | Compare an earlier answer with feedback and submit a correction | revision artifact linked to source attempt | correction started/submitted, retry events |
| `RETRIEVAL_PROMPT` | Test delayed retrieval with text, selection, or speech response | retrieval result with prior-evidence link | answer or recording events |
| `SELF_ASSESS` | Collect confidence or perceived difficulty without changing mastery | self-rating fact | self rating submitted |

`READ`, `LISTEN`, `WRITE`, and `RECORD` are modalities, not executable primitives. `SELECT_ONE` and `SELECT_MULTI` are one `SELECT` primitive with cardinality. Highlight and annotation are one `EVIDENCE_SELECT`. Rewrite, error correction, and repeated speaking are configurations of `COMPARE_REVISE`. Pause is a runtime session command, not package content.

## Common activity contract

Each activity defines `activity_id`, primitive `type`, `phase_id`, `skill_refs`, prompt, resource references, primitive `config`, completion rule, feedback timing and allowed feedback, timeout behavior, accessibility metadata, and required evidence events.

IDs are unique within their namespace. All references must resolve. A phase orders activity IDs; an activity belongs to exactly one phase. The validator rejects an activity whose configuration does not satisfy its primitive contract.

Every primitive inherits `completion.required`, `completion.submit_required`, `timeout.limit_seconds`, `timeout.on_timeout`, `accessibility.keyboard_operable`, `accessibility.screen_reader_label`, and an explicit feedback allowlist. The following matrix freezes primitive-specific input, interaction, result, event, feedback, and accessibility behavior:

| Type | Input and config | Interaction and completion | Result and events | Feedback and accessibility |
| --- | --- | --- | --- | --- |
| `INSTRUCTION` | Prompt plus package resources; `acknowledge_required` | Read, then acknowledge when required | acknowledgement fact; activity lifecycle | no correctness; keyboard acknowledgement and readable label |
| `PRESENT_TEXT` | Text/rubric/comparison resource; `display_mode` continuous or paged | Read or revisit; completion follows configured acknowledgement-free viewing rule | visit/revisit counts; `text_revisited` and lifecycle | no answer feedback; structured reading order and screen-reader text |
| `PLAY_AUDIO` | Audio-script resource; `max_plays` 1–5 and `allow_seek` | Runtime-controlled play/pause/replay within limit | play count, positions, effective listening time; audio events | no answer feedback; keyboard media controls and transcript resource reference |
| `SELECT` | 2–20 ID/label options; one/multiple mode and cardinality | Select, change, and submit within bounds | immutable submitted option IDs plus revisions; answer events | correctness/explanation only at configured time; keyboard group labels |
| `MATCH` | Bounded ID/label `left_items` and `right_items` | Create and revise mappings, then submit | submitted ID pairs and revision count; answer events | configured comparison/correctness; non-drag keyboard mapping available |
| `ORDER` | Bounded ID/label `items` | Reorder and submit | ordered item IDs and revision count; answer events | configured comparison/correctness; keyboard move controls |
| `TEXT_RESPONSE` | Response kind, character bounds, optional artifact type | Type, edit, and submit | submitted text or hashed text artifact; answer/artifact/revision events | rubric, explanation, or comparison after configured boundary; labelled editor |
| `EVIDENCE_SELECT` | Text resource, span bounds, revision permission, raw-selection preservation | Select zero or more allowed spans, optionally annotate/revise, then submit | original and final offsets, annotations, resource ID; evidence events | comparison after submission; keyboard range selection and offset narration |
| `SPEAK_RECORD` | Duration bounds, take limit, audio artifact type | Record, stop, review when allowed, and submit a take | audio artifact ID, duration, take number, optional transcript ID; recording/artifact events | rubric only after configured boundary; keyboard recorder with visual and nonvisual status |
| `COMPARE_REVISE` | Existing activity ID, correction/rewrite/repeat mode, artifact type | Inspect fixed feedback, produce a new attempt, and submit | new artifact/answer linked to original without overwrite; correction/retry events | comparison and rubric after submission; original and revision separately navigable |
| `RETRIEVAL_PROMPT` | Text/select/speech response mode and prior evidence references | Generate an answer before restudy | retrieval attempt linked to historical evidence; answer or recording events | explanation after submission; modality-appropriate accessible control |
| `SELF_ASSESS` | Integer scale and complete label set | Choose and submit one rating | self-rating fact only; `self_rating_submitted` | comparison permitted, never mastery feedback; labelled radio/slider alternatives |

Raw selections, recordings, drafts, and retries are never overwritten by later edits. Timeout always emits incomplete/current/abandoned facts according to `on_timeout`; it never fabricates completion.

## Feedback modes

Training mode may allow hints, post-submission correction, and retry according to fixed package policy. Assessment mode forbids hints, retry, dynamic difficulty reduction, correction before completion, explanations before submission, and reward presentation during performance. Analysis occurs after the assessment closes.

## Resources and paths

V0.1 resources are embedded `plain_text` or `markdown_subset` data. They cannot name external URLs or host files. Artifact metadata uses safe relative paths, but a training package cannot choose an arbitrary artifact destination.

## Validation

Validation is deterministic: byte/depth/count limits, JSON Schema, reference integrity, primitive semantics, assessment constraints, dangerous-content checks, version compatibility, and package-ID collision policy. Any failure rejects the whole package; no best-effort execution exists.
