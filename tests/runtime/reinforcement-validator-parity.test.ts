import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { createProtocolValidator } from "../../src/protocol/validator.js";

type Document = Record<string, any>;

const repositoryRoot = resolve(process.cwd());
const valid = JSON.parse(readFileSync(
  resolve(repositoryRoot, "tests/protocol/fixtures/adversarial/pattern-broken-regression/historical-award.json"),
  "utf8",
)) as Document;
const temporaryPaths: string[] = [];

function pythonAccepts(document: Document): boolean {
  const directory = mkdtempSync(join(tmpdir(), "band8-reinforcement-parity-"));
  temporaryPaths.push(directory);
  const path = join(directory, "decision.json");
  writeFileSync(path, `${JSON.stringify(document)}\n`, "utf8");
  return spawnSync("python", ["tests/protocol/validate_protocol.py", "reinforcement-decision", path], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).status === 0;
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("reinforcement decision semantic parity", () => {
  it("gives the same accept/reject verdict in TypeScript and Python", () => {
    const duplicateImprovementSession = structuredClone(valid);
    duplicateImprovementSession.evidence_chain.repeated_improvement[1].session_id = duplicateImprovementSession.evidence_chain.repeated_improvement[0].session_id;
    const impossibleDelay = structuredClone(valid);
    impossibleDelay.evidence_chain.delayed_retrieval.occurred_at = new Date(
      Date.parse(impossibleDelay.evidence_chain.targeted_intervention.occurred_at) + 3_600_000,
    ).toISOString();
    impossibleDelay.evidence_chain.delayed_retrieval.delay_seconds = 86_400;
    const weaknessAfterIntervention = structuredClone(valid);
    weaknessAfterIntervention.evidence_chain.recurring_weakness[1].occurred_at = "2026-09-01T01:00:00Z";
    const corpus = [valid, duplicateImprovementSession, impossibleDelay, weaknessAfterIntervention];
    const expected = [true, false, false, false];
    const validator = createProtocolValidator(repositoryRoot);

    const typescript = corpus.map((document) => {
      try {
        validator.validateReinforcementDecision(document);
        return true;
      } catch {
        return false;
      }
    });
    const python = corpus.map(pythonAccepts);

    expect(typescript).toEqual(expected);
    expect(python).toEqual(expected);
  });
});
