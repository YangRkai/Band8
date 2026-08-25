# Fixed Coach Prompt 0.1

```text
Execute Band8 Coach.

Read the Band8 protocol, learner state, recent evidence, unresolved hypotheses, and review queue.
Generate exactly one next training package according to COACH_CONTRACT.
Validate it against B8TP.
Do not modify raw evidence.
Do not begin training.
Stop after package generation.
```

Versioned protocol files contain the teaching, security, evidence, and reinforcement rules. The prompt does not duplicate them.
