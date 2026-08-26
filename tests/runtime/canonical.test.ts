import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  canonicalBytes,
  canonicalHash,
  canonicalJson,
  parseJsonStrict,
} from "../../src/protocol/canonical.js";

interface ConformanceCase {
  name: string;
  input_json: string;
  canonical_json: string | null;
  valid: boolean;
}

describe("canonical package identity", () => {
  it("sorts keys, removes insignificant whitespace, and preserves Unicode", () => {
    expect(canonicalJson({ b: 1, a: "λ" })).toBe('{"a":"λ","b":1}');
  });

  it("returns a stable SHA-256 identity for equivalent object key order", () => {
    expect(canonicalHash({ b: 1, a: "λ" })).toBe(canonicalHash({ a: "λ", b: 1 }));
    expect(canonicalHash({ b: 1, a: "λ" })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("matches the shared RFC 8785 canonical byte fixtures", () => {
    const cases = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "tests/protocol/fixtures/canonicalization/jcs-conformance.json"),
        "utf8",
      ),
    ) as ConformanceCase[];

    for (const fixture of cases) {
      const operation = () => {
        const parsed = parseJsonStrict(fixture.input_json);
        return Buffer.from(canonicalBytes(parsed)).toString("utf8");
      };
      if (fixture.valid) {
        expect(operation(), fixture.name).toBe(fixture.canonical_json);
      } else {
        expect(operation, fixture.name).toThrow();
      }
    }
  });

  it("matches the regenerated Python package hash for the approved assessment fixture", () => {
    const packageDocument = parseJsonStrict(
      readFileSync(
        resolve(process.cwd(), "tests/protocol/fixtures/valid/assessment-training-package.json"),
        "utf8",
      ),
    );
    const evaluation = JSON.parse(
      readFileSync(
        resolve(process.cwd(), "tests/protocol/fixtures/valid/protected-evaluation.json"),
        "utf8",
      ),
    ) as { package_hash: string };

    expect(canonicalHash(packageDocument)).toBe(evaluation.package_hash);
  });
});
