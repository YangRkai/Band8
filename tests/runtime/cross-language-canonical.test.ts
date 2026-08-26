import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { describe, expect, it } from "vitest";

import { canonicalBytes, parseJsonStrict } from "../../src/protocol/canonical.js";

interface ConformanceCase {
  name: string;
  input_json: string;
  valid: boolean;
}

const pythonCanonicalizer = [
  "import sys",
  "from tests.protocol.validate_protocol import canonical_json_bytes, strict_json_loads",
  "sys.stdout.buffer.write(canonical_json_bytes(strict_json_loads(sys.stdin.buffer.read().decode('utf-8'))))",
].join("; ");

function pythonCanonicalBytes(input: string): Buffer {
  const result = spawnSync("python", ["-c", pythonCanonicalizer], {
    cwd: process.cwd(),
    input,
    encoding: null,
  });
  if (result.status !== 0) {
    throw new Error(Buffer.from(result.stderr).toString("utf8"));
  }
  return Buffer.from(result.stdout);
}

describe("Python and TypeScript JCS conformance", () => {
  it("produces byte-identical canonical output for every valid shared fixture", () => {
    const cases = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "tests/protocol/fixtures/canonicalization/jcs-conformance.json"),
        "utf8",
      ),
    ) as ConformanceCase[];

    const differences = cases
      .filter((fixture) => fixture.valid)
      .map((fixture) => {
        const typescript = Buffer.from(canonicalBytes(parseJsonStrict(fixture.input_json)));
        const python = pythonCanonicalBytes(fixture.input_json);
        return {
          name: fixture.name,
          typescript: typescript.toString("hex"),
          python: python.toString("hex"),
          equal: typescript.equals(python),
        };
      })
      .filter((fixture) => !fixture.equal);

    expect(differences).toEqual([]);
  });

  it("produces byte-identical canonical output for the approved package that exposed the defect", () => {
    const input = readFileSync(
      resolve(process.cwd(), "tests/protocol/fixtures/valid/assessment-training-package.json"),
      "utf8",
    );
    const typescript = Buffer.from(canonicalBytes(parseJsonStrict(input)));
    const python = pythonCanonicalBytes(input);

    expect(typescript.equals(python)).toBe(true);
  });
});
