# Band8 Data Flow

## Coach-to-runtime flow

```mermaid
sequenceDiagram
    participant U as Learner
    participant C as External Coach
    participant V as Import Validator
    participant B as Band8 Runtime
    participant E as Evidence Store
    C->>E: Read protocol-visible history and inference records
    C->>C: Diagnose, test hypotheses, choose pedagogy
    C->>V: Write exactly one training package
    V->>V: Schema, limits, references, security, version checks
    alt valid
        V->>B: Accepted immutable package
        U->>B: Execute activities
        B->>E: Append events and artifacts
        B->>E: Write traceable session result
    else invalid
        V-->>C: Deterministic rejection; no partial execution
    end
```

## Next-cycle flow

The Coach reads versioned protocol files, learner state, recent session packages, events, results, artifacts, unresolved hypotheses, and the review queue. It may append or supersede inference records, but it cannot alter raw events. It generates one new package, validates it, and stops. Band8 later imports and executes that package without understanding the Coach's reasoning.

## Evidence lifecycle

1. Runtime assigns event IDs and strictly increasing `sequence_number` values.
2. Runtime records wall-clock `timestamp` plus session-relative `monotonic_offset_ms`.
3. User-created essays, revisions, audio, transcripts, and selections receive artifact metadata and a SHA-256 content hash.
4. Session result aggregates completed activities, outcomes, corrections, retries, self-assessments, reinforcement events, and evidence references.
5. Hypotheses cite supporting and contradicting evidence separately.
6. Review constraints preserve due dates and prior review facts; the Coach chooses whether and how to schedule them in a package.
7. Export copies the complete graph without rewriting identifiers.

## Failure behavior

- Malformed, oversized, deeply nested, unknown-version, unsafe, or structurally invalid input is rejected before persistence as an accepted package.
- A duplicate package ID is rejected unless an explicit future migration contract assigns a new identity; V0.1 never overwrites.
- Interrupted sessions retain emitted events and produce an abandonment result when possible.
- Invalid historical records are preserved and marked by a new invalidation event.
