# Band8 Phase 1D Local Web Shell Design

## Scope

Phase 1D has two independently verified closures. 1D-A replaces UTC effective-day identity with a Runtime-owned IANA learning timezone and immutable timezone epochs. 1D-B adds a loopback-only local HTTP adapter and a learner-safe React presentation layer. B8TP remains unchanged, Runtime remains the only learning authority, and no remote, cloud, push, or deployment operation is in scope.

## 1D-A: learning timezone

`LearningTimezoneStore` owns `settings/learning-timezone.json` and immutable per-session records under `reinforcement/learning-days/`. The settings document contains an ordered epoch history with `timezone_epoch_id`, canonical `learning_timezone`, `effective_from`, and `created_at`. Initial configuration creates the first epoch; an explicit update appends a new epoch and never edits an earlier epoch.

Runtime validates timezone names through `Intl.DateTimeFormat` and rejects offset strings and unsupported identifiers. Every clock read and epoch identifier is injectable in tests. A qualifying session receives exactly one immutable learning-day record containing its session identity, epoch identity, local calendar date, completion time, and timezone. Re-evaluation and restart reuse that record. No raw event, artifact, result, checkpoint, package, or protocol document is rewritten.

The streak projection receives Runtime-owned learning-day records. Total effective days and best streak span all epochs. Current streak is calculated only inside the current epoch, so changing timezone cannot join the old calendar to the new one. Historical records keep their original local date even after timezone changes. A target session earns `STREAK_EXTENDED` only when its immutable learning-day identity was not already represented by an earlier qualifying session.

## 1D-B: local adapter and product shell

The local server uses Node's built-in HTTP implementation and binds only `127.0.0.1`. Port `0` selects an available port unless the user supplies `--port`. The same process serves built Vite assets and `/api/v1/` endpoints. HTTP handlers validate transport input, call `Band8Runtime`, and serialize safe DTOs; they contain no mission, evaluation, continuation, reinforcement, or result derivation.

Every startup creates an unpredictable in-memory token. The entry HTML receives that token in a bootstrap meta element. Mutations require an exact loopback Origin, an allowed Host, the startup token, JSON content type, and route-specific body limits. Responses do not emit wildcard CORS. Static responses use a restrictive CSP and other browser security headers. Uploads carry selected file content, never a filesystem path. Downloads are created from a Runtime-bound Coach export, never a query path.

Runtime presentation projections provide Today, active training, Coach status, Progress, and paginated History. They expose learner activity projections and factual evidence references while omitting protected evaluation, scoring keys, internal paths, Coach-only hidden data, stack traces, and security credentials. Browser refresh reloads those projections and never replays a mutation.

The React shell has only TODAY, TRAIN, PROGRESS, HISTORY, and COACH primary navigation, with Settings as a secondary surface. It renders untrusted package, learner, and Coach text through React text nodes without raw HTML or Markdown execution. Activity submission calls Runtime through the adapter; SELECT correctness is absent before submit, and TEXT_RESPONSE artifact identity is returned by Runtime. Reveal order and eligibility come directly from Runtime projections.

## Verification

1D-A is committed only after timezone boundary, epoch, immutability, anti-farming, restart, Phase 1C regression, typecheck, build, and diff checks pass. 1D-B is committed only after server security tests, frontend tests, Playwright browser flows, three viewport checks, restart/refresh persistence, protected-answer payload inspection, domain-duplication audit, protocol and Runtime regressions, build, typecheck, and manual browser dogfood pass.
