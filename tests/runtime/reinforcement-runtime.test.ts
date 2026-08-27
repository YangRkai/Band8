import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createProtocolValidator } from "../../src/protocol/validator.js";
import { Band8Runtime } from "../../src/runtime/runtime.js";
import { ReinforcementStore } from "../../src/storage/reinforcement-store.js";
import { initializeWorkspace, storageKey } from "../../src/storage/workspace.js";

type Document = Record<string, any>;

const repositoryRoot = resolve(process.cwd());
const packageText = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/training-package.json"), "utf8");
const protectedText = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/protected-evaluation.json"), "utf8");
const historicalAward = JSON.parse(readFileSync(
  resolve(repositoryRoot, "tests/protocol/fixtures/adversarial/pattern-broken-regression/historical-award.json"),
  "utf8",
)) as Document;
const regressionDecision = JSON.parse(readFileSync(
  resolve(repositoryRoot, "tests/protocol/fixtures/adversarial/pattern-broken-regression/current-regression.json"),
  "utf8",
)) as Document;
const workspaces: string[] = [];

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "band8-reinforcement-"));
  workspaces.push(path);
  return path;
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function runtime(path: string): Band8Runtime {
  let event = 0;
  let second = 0;
  return Band8Runtime.open({
    repositoryRoot,
    workspacePath: path,
    learnerId: "learner-runtime",
    eventIdFactory: () => `event-reinforcement-${++event}`,
    now: () => new Date(Date.UTC(2026, 7, 27, 10, 0, second++)).toISOString(),
  });
}

function completeReading(instance: Band8Runtime, sessionId: string): void {
  instance.importPackage(packageText, protectedText);
  instance.createSession("pkg-runtime-reading-001", sessionId);
  instance.startSession(sessionId);
  instance.completeCurrentActivity(sessionId);
  instance.completeCurrentActivity(sessionId);
  instance.completeCurrentActivity(sessionId, { optionIds: ["true"] });
  instance.completeCurrentActivity(sessionId, { optionIds: ["not-given"] });
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("reinforcement decision store", () => {
  it("publishes an immutable decision idempotently, rejects collisions, and atomically replaces current qualification", () => {
    const path = workspace();
    const runtimeWorkspace = initializeWorkspace(path);
    const store = new ReinforcementStore(runtimeWorkspace, createProtocolValidator(repositoryRoot));

    expect(store.publishDecision(historicalAward)).toBe("PUBLISHED");
    expect(store.publishDecision(historicalAward)).toBe("IDEMPOTENT");
    expect(store.listDecisions()).toEqual([historicalAward]);
    expect(() => store.publishDecision({ ...historicalAward, evaluated_at: "2026-09-02T00:00:00Z" })).toThrow(/collision/iu);

    const confirmed = {
      policy_version: "0.1.0",
      learner_id: historicalAward.learner_id,
      skill_id: historicalAward.skill_id,
      error_pattern_id: historicalAward.error_pattern_id,
      qualification: "confirmed",
      current_decision_id: historicalAward.decision_id,
      historical_award_id: historicalAward.decision_id,
      evidence_refs: [historicalAward.decision_id],
      evaluated_at: historicalAward.evaluated_at,
    };
    store.publishQualification(confirmed);
    store.publishDecision(regressionDecision);
    store.publishQualification({
      ...confirmed,
      qualification: "revoked",
      current_decision_id: regressionDecision.decision_id,
      evidence_refs: regressionDecision.evidence_chain.regression_evidence_refs,
      evaluated_at: regressionDecision.evaluated_at,
    });
    expect(store.publishQualification(confirmed)).toBe("STALE_IGNORED");
    expect(store.readQualification(confirmed.learner_id, confirmed.skill_id, confirmed.error_pattern_id)).toMatchObject({
      qualification: "revoked",
      historical_award_id: historicalAward.decision_id,
    });

    writeFileSync(join(path, "reinforcement", "decisions", "wrong-storage-key.json"), `${JSON.stringify(historicalAward)}\n`, "utf8");
    expect(() => store.listDecisions()).toThrow(/path identity mismatch/iu);
  });

  it("advances equal-time qualification aggregates, rejects corruption, and remains restart-safe", () => {
    const path = workspace();
    const runtimeWorkspace = initializeWorkspace(path);
    const store = new ReinforcementStore(runtimeWorkspace, createProtocolValidator(repositoryRoot));
    store.publishDecision(historicalAward);
    store.publishDecision(regressionDecision);
    const first = {
      policy_version: "0.1.0",
      learner_id: historicalAward.learner_id,
      skill_id: historicalAward.skill_id,
      error_pattern_id: historicalAward.error_pattern_id,
      qualification: "revoked",
      current_decision_id: regressionDecision.decision_id,
      historical_award_id: historicalAward.decision_id,
      evidence_refs: ["evt-assessment-regression-001"],
      evaluated_at: regressionDecision.evaluated_at,
    };
    expect(store.publishQualification(first)).toBe("PUBLISHED");

    const aggregateDecision = {
      ...regressionDecision,
      decision_id: "decision-pattern-aggregate",
      evidence_chain: {
        ...regressionDecision.evidence_chain,
        regression_evidence_refs: ["evt-assessment-regression-001", "evt-assessment-regression-002"],
      },
    };
    store.publishDecision(aggregateDecision);
    const aggregate = {
      ...first,
      current_decision_id: aggregateDecision.decision_id,
      evidence_refs: aggregateDecision.evidence_chain.regression_evidence_refs,
    };
    expect(store.publishQualification(aggregate)).toBe("PUBLISHED");
    expect(store.publishQualification(aggregate)).toBe("IDEMPOTENT");
    expect(store.publishQualification(first)).toBe("STALE_IGNORED");

    const wrongSupersedesDecision = { ...aggregateDecision, decision_id: "decision-pattern-wrong-parent", supersedes: "decision-unrelated" };
    store.publishDecision(wrongSupersedesDecision);
    expect(() => store.publishQualification({ ...aggregate, current_decision_id: wrongSupersedesDecision.decision_id }))
      .toThrow(/decision relation/iu);

    const qualificationPath = join(path, "reinforcement", "qualifications", `${storageKey(`${first.learner_id}:${first.skill_id}:${first.error_pattern_id}`)}.json`);
    writeFileSync(qualificationPath, `${JSON.stringify({ ...aggregate, evaluated_at: "2026-09-11T09:00:00Z" })}\n`, "utf8");
    expect(() => store.readQualification(first.learner_id, first.skill_id, first.error_pattern_id)).toThrow(/decision relation/iu);
  });
});

describe("Runtime reinforcement API", () => {
  it("is restart and rebuild stable and never mutates raw events or results", () => {
    const path = workspace();
    let instance = runtime(path);
    completeReading(instance, "session-reinforcement-reading");
    const sessionRoot = join(path, "sessions", storageKey("session-reinforcement-reading"));
    const eventPath = join(sessionRoot, "events.ndjson");
    const resultPath = join(sessionRoot, "result.json");
    const rawBefore = { events: hashFile(eventPath), result: hashFile(resultPath) };

    const first = instance.evaluateReinforcement("session-reinforcement-reading");
    const second = instance.evaluateReinforcement("session-reinforcement-reading");
    instance.rebuildResult("session-reinforcement-reading");
    instance = runtime(path);
    const reopened = instance.evaluateReinforcement("session-reinforcement-reading");

    expect(second.eligible.map((item: Document) => item.semantic_id)).toEqual(first.eligible.map((item: Document) => item.semantic_id));
    expect(reopened.eligible.map((item: Document) => item.semantic_id)).toEqual(first.eligible.map((item: Document) => item.semantic_id));
    expect(first.eligible.map((item: Document) => item.event_type)).toEqual(expect.arrayContaining([
      "SESSION_COMPLETE",
      "MISSION_ADVANCED",
      "STREAK_EXTENDED",
    ]));
    expect(first.mission.status).toBe("VALIDATION_PENDING");
    expect(first.streak.total_effective_days).toBe(1);
    expect({ events: hashFile(eventPath), result: hashFile(resultPath) }).toEqual(rawBefore);
  });

  it("denies reinforcement publication when target evidence is quarantined", () => {
    const path = workspace();
    const instance = runtime(path);
    completeReading(instance, "session-reinforcement-quarantine");
    const resultPath = join(path, "sessions", storageKey("session-reinforcement-quarantine"), "result.json");
    const result = JSON.parse(readFileSync(resultPath, "utf8")) as Document;
    result.objective_results[0].outcome = "unsuccessful";
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`, "utf8");

    expect(() => instance.evaluateReinforcement("session-reinforcement-quarantine")).toThrow(/not authoritative/iu);
  });
});
