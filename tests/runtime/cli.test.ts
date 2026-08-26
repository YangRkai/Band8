import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { executeCli } from "../../src/cli/index.js";

const repositoryRoot = resolve(process.cwd());
const packagePath = resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/training-package.json");
const protectedPath = resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/protected-evaluation.json");
const temporaryPaths: string[] = [];

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "band8-cli-"));
  temporaryPaths.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("headless CLI harness", () => {
  it("validates and imports a package through the runtime boundary", async () => {
    const path = workspace();
    const output: string[] = [];
    const dependencies = { repositoryRoot, write: (value: string) => output.push(value) };

    expect(await executeCli(["--workspace", path, "validate", packagePath, "--protected", protectedPath], dependencies)).toBe(0);
    expect(await executeCli(["--workspace", path, "import", packagePath, "--protected", protectedPath], dependencies)).toBe(0);
    expect(output.join("\n")).toMatch(/VALID.*IMPORTED/su);
  });

  it("runs the Reading Golden fixture interactively without placing scoring data in learner output", async () => {
    const path = workspace();
    const output: string[] = [];
    let event = 0;
    const dependencies = {
      repositoryRoot,
      write: (value: string) => output.push(value),
      read: async () => "true",
      eventIdFactory: () => `event-cli-${++event}`,
      now: () => "2026-08-26T14:00:00.000Z",
    };
    await executeCli(["--workspace", path, "import", packagePath, "--protected", protectedPath], dependencies);
    const answers = ["", "", "true", "not-given"];
    dependencies.read = async () => answers.shift() ?? "";

    expect(await executeCli(["--workspace", path, "run", "pkg-runtime-reading-001", "--session", "session-cli-golden"], dependencies)).toBe(0);
    const serialized = output.join("\n");
    expect(serialized).toContain("COMPLETED");
    expect(serialized).not.toMatch(/correct_option_ids|scoring_rule|integrity_ref/u);
    expect(JSON.parse(readFileSync(join(path, "registry", "imports.json"), "utf8")).packages).toHaveProperty("pkg-runtime-reading-001");
  });
});
