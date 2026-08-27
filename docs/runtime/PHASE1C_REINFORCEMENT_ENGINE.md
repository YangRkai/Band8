# Phase 1C Evidence-Driven Reinforcement Engine

## Boundary and objective

The Phase 1C engine converts authoritative Runtime evidence into deterministic learning reinforcement projections. Its objective is sustained effective learning behavior. It does not maximize session count, active minutes, daily opens, clicks, or time in the application. When engagement and evidence quality conflict, learning truth takes priority.

The External Codex Coach selects training targets and pedagogy. The Reinforcement Engine independently applies Runtime policy `0.1.0`; a package, hypothesis, self-rating, or Coach claim cannot grant an event, override a threshold, alter a streak, or declare mastery. Reinforcement has no reverse write path into raw events, artifacts, protected evaluation, session results, hypotheses, IELTS assessments, or skill estimates.

## Persistence and recomputation

The workspace owns two Phase 1C boundaries:

- `reinforcement/decisions/` contains immutable, protocol-valid `PATTERN_BROKEN` historical awards and later qualification updates.
- `reinforcement/qualifications/` contains atomically replaceable current qualification projections.

Only `PATTERN_BROKEN` is persisted as a B8TP reinforcement decision because the frozen `0.1.0` schema permits only `reward_type = pattern_broken`. `SESSION_COMPLETE`, `MISSION_ADVANCED`, `TRANSFER_CONFIRMED`, `RETENTION_CONFIRMED`, `STREAK_EXTENDED`, and objective-only `PERSONAL_BEST` are Runtime projections. They have stable identities derived from policy version, event type, and sorted evidence references through RFC 8785 JCS plus SHA-256, so restart, result rebuild, and repeated CLI evaluation cannot create a second semantic event.

Historical decisions retain the policy version under which they were awarded. Current qualification is recomputed from preserved evidence. A later contradictory assessment creates a new `qualification_update` with `revoked` status and a `supersedes` reference; it never deletes or edits the historical award.

## Mission and open loop

Mission identity and content come from the current valid Training Package: run, objective, target skills, and hypothesis references. Runtime projects this lifecycle:

- `OPEN`: package/session is ready and training has not started.
- `IN_PROGRESS`: the session is running or suspended.
- `EVIDENCE_PENDING`: the unit completed, but no authoritative success establishes progress.
- `VALIDATION_PENDING`: authoritative success exists, while delayed stability or stronger validation remains open.
- `CLOSED`: successful assessment evidence or a currently confirmed qualification closes the target.

Completing one exercise therefore does not imply that a mission is closed. Reading Golden finishes in `VALIDATION_PENDING`; the subjective Writing dogfood finishes in `EVIDENCE_PENDING` because artifact completion is factual but correctness is not independently established.

The mission also carries a read-only goal projection copied from the valid package: overall target, section minimums, unresolved hypothesis blockers, relevant current qualification status, and authoritative assessment evidence references. It never calculates a percentage, decimal Band movement, or distance to the learner goal.

## Effective day and streak

Policy `0.1.0` uses a UTC calendar-day boundary. A day qualifies only when a completed authoritative, non-anomalous session contains legitimate learner submission evidence. Login, app open, instruction-only activity, quarantine, replayed session identity, and clock-anomalous evidence do not count. Multiple qualifying sessions on the same UTC day contribute one effective day.

The projection reports current streak, best streak, total effective days, and the exact day keys. A gap ends only the current streak; it never deletes achievements, lowers skill evidence, or changes best/total history. Streak means continuity of qualifying training, not mastery or English improvement. Recovery tokens are deferred because policy `0.1.0` has no frozen deterministic, abuse-resistant rule for them.

## Eligibility rules

- `SESSION_COMPLETE`: authoritative completed session plus legitimate learner participation.
- `MISSION_ADVANCED`: a targeted intervention or authoritative successful observation advances the package-selected mission.
- `TRANSFER_CONFIRMED`: a successful relevant objective observation on transfer material plus a trustworthy, strictly earlier same-skill observation with a different resource hash. The transfer hash must not have appeared in earlier same-skill observations, so repeating the same resource cannot farm the event. Changed hash is a minimal proxy, not a scientific claim of complete transfer.
- `RETENTION_CONFIRMED`: successful same-skill evidence at least 86,400 seconds after earlier successful evidence, with no clock anomaly. Twenty-four hours is only the minimum delayed boundary and never mastery.
- `PATTERN_BROKEN`: two failures from different earlier sessions for one skill/error-pattern identity; a later targeted intervention; two successful improvements from different sessions; a separate successful retrieval at least 86,400 seconds after the intervention; successful changed-material transfer; and no unresolved contradictory assessment at award time.
- `STREAK_EXTENDED`: the target session creates a new qualifying UTC effective day.
- `PERSONAL_BEST`: available only when a comparable objective metric with identical measurement semantics exists. The current categorical result model does not fabricate one.

The reveal model selects one primary event and orders support as `PATTERN_BROKEN`, objective `PERSONAL_BEST`, `RETENTION_CONFIRMED`, `TRANSFER_CONFIRMED`, `MISSION_ADVANCED`, `STREAK_EXTENDED`, then `SESSION_COMPLETE`. It carries event objects, evidence references, and any qualification change; terminal formatting and animation are outside the domain contract.

## Anti-reward-hacking

- Stable package/session/evidence identities prevent duplicate import, restart, rebuild, and repeated CLI evaluation from farming semantic events.
- Same-resource repetition cannot confirm transfer; anomalous or later-occurring source observations cannot establish its causal baseline.
- Same-session or easy repetition cannot satisfy the distinct-session Pattern Broken chain.
- Self-rating and generated Coach text are not authoritative outcome evidence.
- Package reward claims and thresholds are ignored because package schema and Runtime collection do not expose reward authority.
- Clock anomaly denies delayed-time and effective-day qualification for the affected session.
- Quarantined or non-authoritative evidence cannot enter policy evaluation or decision publication.
- Subjective Writing artifacts prove submission, revision, and attempted transfer, but do not prove successful transfer without an authoritative outcome.

## CLI

After `npm run build`, local debug projections are available through:

```text
band8 --workspace <path> reinforce evaluate <session-id>
band8 --workspace <path> reveal <session-id>
band8 --workspace <path> mission <session-id-or-run-id>
```

The CLI emits canonical JSON returned by `Band8Runtime`; it contains no eligibility logic.

## Explicit non-capabilities

Phase 1C adds no PWA or Web product shell, Speaking/audio pipeline, automatic Coach, calibrated IELTS estimation, fake decimal Band movement, cloud service, network dependency, push, or deployment.
