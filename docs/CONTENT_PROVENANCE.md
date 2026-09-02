# Content Provenance Policy

Band8 treats every training package as untrusted input and requires provenance on each B8TP resource.

## Public repository content

Demo packages and positive-path fixtures intended for public use must be newly generated, public-domain, or licensed for redistribution. Their resource metadata must identify the corresponding `origin_type`, content hash, source or generator information, license/attribution when applicable, and redistribution status.

The current public Reading and Writing examples are synthetic materials generated for Band8 tests. They are not copied IELTS questions or extracts from commercial test banks.

## Negative tests

`unknown` or non-cleared `user_provided` content is allowed only in clearly named negative or adversarial fixtures. It must not be used by the README demo, Quick Start, screenshots, or normal examples. The malicious-instruction fixture is intentionally non-cleared test data used to prove that learner text remains inert.

## Contributions

Do not submit official IELTS questions, Cambridge IELTS book content, commercial test-bank material, real learner submissions, or other material without documented redistribution rights. Rewording source material does not establish those rights. Replace uncertain material with newly generated synthetic content and record accurate provenance.

Protocol rules are defined in [B8TP](../protocol/B8TP.md). Validation behavior is part of the [trust boundaries](architecture/TRUST_BOUNDARIES.md).
