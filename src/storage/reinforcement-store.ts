import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { canonicalHash, canonicalJson, parseJsonStrict } from "../protocol/canonical.js";
import type { ProtocolValidator } from "../protocol/validator.js";
import { writeTextAtomic } from "./atomic.js";
import type { RuntimeWorkspace } from "./workspace.js";
import { storageKey } from "./workspace.js";

type Document = Record<string, any>;

const idPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
const skillPattern = /^[a-z][a-z0-9.-]{2,127}$/u;
const rfc3339Pattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;

function qualificationIdentity(learnerId: string, skillId: string, errorPatternId: string): string {
  return `${learnerId}:${skillId}:${errorPatternId}`;
}

function validateQualification(document: Document): void {
  const required = [
    "policy_version", "learner_id", "skill_id", "error_pattern_id", "qualification",
    "current_decision_id", "historical_award_id", "evidence_refs", "evaluated_at",
  ];
  if (Object.keys(document).some((key) => !required.includes(key)) || required.some((key) => document[key] === undefined)) {
    throw new Error("invalid current qualification projection");
  }
  if (!['confirmed', 'weakened', 'revoked', 'superseded'].includes(document.qualification)) {
    throw new Error("invalid current qualification status");
  }
  if (
    document.policy_version !== "0.1.0"
    || typeof document.learner_id !== "string" || !idPattern.test(document.learner_id)
    || typeof document.skill_id !== "string" || !skillPattern.test(document.skill_id)
    || typeof document.error_pattern_id !== "string" || !idPattern.test(document.error_pattern_id)
    || typeof document.current_decision_id !== "string" || !idPattern.test(document.current_decision_id)
    || typeof document.historical_award_id !== "string" || !idPattern.test(document.historical_award_id)
    || typeof document.evaluated_at !== "string" || !rfc3339Pattern.test(document.evaluated_at)
    || !Number.isFinite(Date.parse(document.evaluated_at))
  ) throw new Error("invalid current qualification identity or time");
  if (
    !Array.isArray(document.evidence_refs)
    || document.evidence_refs.some((reference: unknown) => typeof reference !== "string" || !idPattern.test(reference))
    || new Set(document.evidence_refs).size !== document.evidence_refs.length
  ) {
    throw new Error("invalid current qualification evidence refs");
  }
}

function sameReferences(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((reference, index) => reference === right[index]);
}

export class ReinforcementStore {
  constructor(
    private readonly workspace: RuntimeWorkspace,
    private readonly validator: ProtocolValidator,
  ) {}

  publishDecision(document: Document): "PUBLISHED" | "IDEMPOTENT" {
    this.validator.validateReinforcementDecision(document);
    const path = join(this.workspace.paths.reinforcementDecisions, `${storageKey(document.decision_id)}.json`);
    if (existsSync(path)) {
      const existing = parseJsonStrict(readFileSync(path, "utf8"));
      if (canonicalHash(existing) !== canonicalHash(document)) throw new Error("immutable reinforcement decision collision");
      return "IDEMPOTENT";
    }
    writeTextAtomic(path, `${canonicalJson(document)}\n`);
    return "PUBLISHED";
  }

  listDecisions(): Document[] {
    return readdirSync(this.workspace.paths.reinforcementDecisions, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const document = parseJsonStrict(readFileSync(join(this.workspace.paths.reinforcementDecisions, entry.name), "utf8")) as Document;
        this.validator.validateReinforcementDecision(document);
        if (entry.name !== `${storageKey(document.decision_id)}.json`) throw new Error("reinforcement decision path identity mismatch");
        return document;
      })
      .sort((left, right) => (left.decision_id as string).localeCompare(right.decision_id as string));
  }

  publishQualification(document: Document): "PUBLISHED" | "IDEMPOTENT" | "STALE_IGNORED" {
    validateQualification(document);
    this.#validateDecisionRelation(document);
    const key = qualificationIdentity(document.learner_id, document.skill_id, document.error_pattern_id);
    const path = join(this.workspace.paths.reinforcementQualifications, `${storageKey(key)}.json`);
    if (existsSync(path)) {
      const existing = parseJsonStrict(readFileSync(path, "utf8")) as Document;
      validateQualification(existing);
      this.#validateDecisionRelation(existing);
      if (canonicalHash(existing) === canonicalHash(document)) return "IDEMPOTENT";
      const ordering = Date.parse(document.evaluated_at) - Date.parse(existing.evaluated_at);
      if (ordering < 0) return "STALE_IGNORED";
      if (ordering === 0) {
        const existingRefs = existing.evidence_refs as string[];
        const incomingRefs = document.evidence_refs as string[];
        const incomingSuperset = existingRefs.every((reference) => incomingRefs.includes(reference));
        const existingSuperset = incomingRefs.every((reference) => existingRefs.includes(reference));
        if (incomingSuperset && incomingRefs.length > existingRefs.length) {
          // Equal-time aggregate updates advance by evidence-set inclusion.
        } else if (existingSuperset) return "STALE_IGNORED";
        else throw new Error("current qualification collision at equal evaluation time");
      }
    }
    writeTextAtomic(path, `${canonicalJson(document)}\n`);
    return "PUBLISHED";
  }

  readQualification(learnerId: string, skillId: string, errorPatternId: string): Document | undefined {
    const key = qualificationIdentity(learnerId, skillId, errorPatternId);
    const path = join(this.workspace.paths.reinforcementQualifications, `${storageKey(key)}.json`);
    if (!existsSync(path)) return undefined;
    const document = parseJsonStrict(readFileSync(path, "utf8")) as Document;
    validateQualification(document);
    if (qualificationIdentity(document.learner_id, document.skill_id, document.error_pattern_id) !== key) {
      throw new Error("current qualification path identity mismatch");
    }
    this.#validateDecisionRelation(document);
    return document;
  }

  listQualifications(): Document[] {
    return readdirSync(this.workspace.paths.reinforcementQualifications, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const document = parseJsonStrict(readFileSync(join(this.workspace.paths.reinforcementQualifications, entry.name), "utf8")) as Document;
        validateQualification(document);
        this.#validateDecisionRelation(document);
        const key = qualificationIdentity(document.learner_id, document.skill_id, document.error_pattern_id);
        if (entry.name !== `${storageKey(key)}.json`) throw new Error("current qualification path identity mismatch");
        return document;
      })
      .sort((left, right) => String(left.skill_id).localeCompare(String(right.skill_id)) || String(left.error_pattern_id).localeCompare(String(right.error_pattern_id)));
  }

  #validateDecisionRelation(document: Document): void {
    const decisions = this.listDecisions();
    const historical = decisions.find((decision) => decision.decision_id === document.historical_award_id);
    const current = decisions.find((decision) => decision.decision_id === document.current_decision_id);
    const sameSubject = (decision: Document | undefined): boolean => decision !== undefined
      && decision.learner_id === document.learner_id
      && decision.skill_id === document.skill_id
      && decision.error_pattern_id === document.error_pattern_id;
    if (historical?.decision_type !== "historical_award" || !sameSubject(historical) || !sameSubject(current)) {
      throw new Error("invalid current qualification decision relation");
    }
    if (historical === undefined || current === undefined) throw new Error("invalid current qualification decision relation");
    if (current?.qualification !== document.qualification || current.policy_version !== document.policy_version) {
      throw new Error("invalid current qualification decision relation");
    }
    if (document.evaluated_at !== current.evaluated_at) throw new Error("invalid current qualification decision relation");
    if (current.decision_type === "historical_award") {
      if (current.decision_id !== historical.decision_id) throw new Error("invalid current qualification decision relation");
    } else {
      if (current.supersedes !== historical.decision_id) throw new Error("invalid current qualification decision relation");
      const historicalChain = { ...historical.evidence_chain, regression_evidence_refs: [] };
      const currentBaseChain = { ...current.evidence_chain, regression_evidence_refs: [] };
      if (canonicalHash(historicalChain) !== canonicalHash(currentBaseChain)) {
        throw new Error("invalid current qualification decision relation");
      }
    }
    const expectedRefs = current.decision_type === "historical_award"
      ? [current.decision_id as string]
      : [...current.evidence_chain.regression_evidence_refs as string[]].sort();
    const actualRefs = [...document.evidence_refs as string[]].sort();
    if (!sameReferences(actualRefs, expectedRefs)) throw new Error("invalid current qualification decision relation");
  }
}
