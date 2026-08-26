# Reinforcement Contract 0.1

## Authority

Band8 Reinforcement Engine independently evaluates fixed versioned policy from authoritative evidence. Training packages contain no reinforcement candidates, thresholds, reward decisions, or presentation definitions. Coach supplies only training rationale, hypotheses, targets, and evidence intention and cannot grant a reward.

Rewards, animations, streaks, and badges have no reverse write path into evidence, learner diagnosis, hypothesis confidence, score estimates, or assessment truth.

## Historical award and current qualification

A `historical_award` is append-only evidence that policy conditions were satisfied at its evaluation time. `current qualification` is a derived status that later evidence may confirm, weaken, revoke, or supersede. A qualification update cites and supersedes the earlier decision without deleting its historical award.

Thus a `PATTERN_BROKEN` award on one date remains historically true even if later assessment regression produces `qualification = revoked`. The interface must not equate the revoked current qualification with stable mastery.

## PATTERN_BROKEN V0.1

Runtime policy version `0.1.0` requires all of these machine-verifiable conditions for a confirmed historical award:

1. two unsuccessful observations for the same skill and error-pattern identity from at least two distinct earlier sessions;
2. one targeted-intervention evidence reference after those weaknesses;
3. two subsequent successful improvement observations;
4. one successful retrieval observation at least 86,400 seconds after the intervention;
5. one successful transfer observation whose source and transfer resource hashes differ;
6. an empty set of unresolved contradictory assessment references at evaluation time.

Twenty-four hours is only the minimum delayed-evidence boundary. It never means mastery. Longer retention and later assessment may strengthen qualification; contradictory assessment may weaken or revoke it. Coach and Training Package cannot modify thresholds.

Repeated easy items, one-session repetition, idle time, login, rapid clicks, already-mastered repetition, deliberate difficulty reduction, self-rating, and unverified event outcomes cannot satisfy this policy.

## Other reinforcement

Boss fights, milestones, streaks, and presentation policy remain unavailable for eligibility awards until each receives a separately frozen deterministic policy. V0.1 machine validation closes only `PATTERN_BROKEN`.
