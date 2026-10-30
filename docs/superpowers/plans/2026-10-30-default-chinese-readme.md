# Default Chinese README Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Chinese the default Band8 repository README while preserving the current English documentation behind a bidirectional language switch.

**Architecture:** Documentation-only change. `README.md` becomes the canonical Chinese landing page and `README.en.md` preserves the English version; release-hardening tests pin the language navigation and required project claims.

**Tech Stack:** Markdown, Vitest, Node.js filesystem assertions

**Spec:** `docs/superpowers/specs/2026-10-30-default-chinese-readme-design.md`

## Global Constraints

- Keep `v0.1.0-alpha.1`, commands, architecture boundaries, limitations, license, and trademark statements factually equivalent to the existing README.
- Do not modify B8TP, Runtime, product behavior, dependencies, or package version.
- Do not claim calibrated IELTS scoring, automatic Coach operation, cloud operation, or guaranteed outcomes.
- Preserve all unrelated untracked files.

## Review Focus

- GitHub renders `README.md` in Chinese by default and its first navigation link points to `README.en.md`.
- `README.en.md` links back to `README.md` without broken relative paths.
- Commands in both versions remain byte-for-byte equivalent where users copy them.
- Security and alpha limitation language is not weakened in translation.
- Existing documentation links remain valid from both root-level README files.

---

### Task 1: Pin the bilingual README contract

**Files:**
- Modify: `tests/release/release-hardening.test.ts`

**Interfaces:**
- Consumes: repository-root Markdown files through existing filesystem test helpers
- Produces: assertions requiring Chinese default content and bidirectional language links

- [ ] **Step 1: Add failing assertions**

Assert that `README.md` contains `# Band8` followed by the Chinese project description and a link to `README.en.md`; assert that `README.en.md` exists and links to `README.md`.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm run check:release`

Expected: FAIL because `README.en.md` does not exist and `README.md` is not Chinese.

### Task 2: Add the Chinese default and preserve English

**Files:**
- Modify: `README.md`
- Create: `README.en.md`

**Interfaces:**
- Consumes: current `README.md` facts, commands, and links
- Produces: Chinese default landing page plus English alternate

- [ ] **Step 1: Preserve the English README**

Copy current English content to `README.en.md` and add `简体中文 | English` navigation with the Chinese link targeting `README.md`.

- [ ] **Step 2: Translate the default README**

Replace `README.md` with a faithful Chinese version. Keep code blocks, paths, version numbers, and product-boundary claims unchanged.

- [ ] **Step 3: Run focused verification and verify GREEN**

Run: `npm run check:release`

Expected: all release-hardening tests pass.

- [ ] **Step 4: Verify Markdown paths and repository hygiene**

Run the repository link check available in release-hardening tests, `git diff --check`, and inspect `git status --short` to ensure unrelated files are untouched.

- [ ] **Step 5: Commit and push**

Commit only the two README files, the regression test, this plan, and its approved design. Push the new commit to `origin/main`; do not deploy.
