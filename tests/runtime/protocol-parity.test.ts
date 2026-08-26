import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { createProtocolValidator } from "../../src/protocol/validator.js";

const root = resolve(process.cwd());
const validator = createProtocolValidator(root);

function load(path: string): unknown {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

describe("Phase 0 Python oracle parity", () => {
  it("preserves package verdicts for committed package fixtures exercised by the oracle", () => {
    const cases: Array<[string, boolean]> = [
      ["tests/protocol/fixtures/valid/minimal-training-package.json", true],
      ["tests/protocol/fixtures/valid/listening-training-package.json", true],
      ["tests/protocol/fixtures/valid/writing-training-package.json", true],
      ["tests/protocol/fixtures/valid/assessment-training-package.json", true],
      ["examples/reading-training-package.json", true],
      ["examples/speaking-training-package.json", true],
      ["tests/protocol/fixtures/adversarial/malicious-instruction-as-data.json", true],
      ["tests/protocol/fixtures/adversarial/assessment-answer-leakage.json", false],
    ];
    const differences = cases.filter(([path, expected]) => {
      try {
        validator.validatePackage(load(path));
        return expected !== true;
      } catch {
        return expected !== false;
      }
    });
    expect(differences, `verdict differences: ${differences.map(([path]) => path).join(", ")}`).toEqual([]);
  });
});
