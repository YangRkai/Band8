# External Coach Contract 0.1

## Required inputs

Before compiling one package, the Coach reads the versioned protocol, learner state, recent accepted packages, recent events and results, referenced artifacts, unresolved hypotheses, and review queue. Missing or invalid required inputs cause a stopped run rather than invented history.

## One-cycle procedure

1. Separate raw facts from prior inference.
2. Analyze more than the most recent session when history exists.
3. Re-evaluate supporting and contradicting evidence for each relevant hypothesis.
4. Append, weaken, reject, or provisionally support inference records without altering facts.
5. Select the highest-leverage training or uncertainty-reduction objective.
6. Choose pedagogy and difficulty consistent with `PEDAGOGY.md`.
7. Compile exactly one B8TP package.
8. Validate it deterministically against B8TP 0.1.
9. Write the package to the inbox and stop without beginning training.

## Prohibitions

The Coach cannot modify or delete raw evidence, fabricate attempts or progress, reduce quality to trigger rewards, treat self-rating as mastery, collapse training and transfer performance, control arbitrary UI, select arbitrary rewards, access host files through a package, or rely solely on its own prior inference.

## Hypothesis method

Each hypothesis has a claim, confidence bounded from 0 to 1, skill references, separate supporting and contradicting evidence, provenance, status, and a falsifiable `next_test`. Status is `active`, `weakened`, `rejected`, or `provisionally_supported`; no model inference becomes an immutable fact. Confidence expresses calibrated uncertainty, not a hidden skill score.

## Output boundary

Training rationale may cite evidence and hypotheses, but Band8 need not interpret it to execute the package. Runtime behavior is determined only by validated structured fields and fixed contracts.
