import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd());

function filesUnder(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const candidate = resolve(path, entry.name);
    return entry.isDirectory() ? filesUnder(candidate) : [candidate];
  });
}

function publicMarkdownFiles(): string[] {
  return [
    ...readdirSync(repositoryRoot)
      .filter((name) => extname(name).toLowerCase() === ".md")
      .map((name) => resolve(repositoryRoot, name)),
    ...filesUnder(resolve(repositoryRoot, "docs")).filter((path) => extname(path).toLowerCase() === ".md"),
  ];
}

describe("open-source release contract", () => {
  it("uses one coherent alpha release identity and declared protocol dependency", () => {
    const packageMetadata = JSON.parse(readFileSync(resolve(repositoryRoot, "package.json"), "utf8"));
    expect(packageMetadata).toMatchObject({
      name: "band8",
      version: "0.1.0-alpha.1",
      description: expect.any(String),
      license: "Apache-2.0",
      private: true,
      engines: { node: "20.x" },
      packageManager: "npm@10.8.2",
      files: ["dist/src", "dist/web", "protocol", "README.md", "LICENSE"],
    });
    expect(readFileSync(resolve(repositoryRoot, "requirements-protocol.txt"), "utf8").trim()).toBe("rfc8785==0.1.4");
  });

  it("ships the required public release documentation", () => {
    for (const path of [
      "LICENSE",
      "README.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
      "CHANGELOG.md",
      "docs/QUICKSTART.md",
      "docs/CONTENT_PROVENANCE.md",
      "docs/releases/v0.1.0-alpha.1.md",
    ]) {
      expect(existsSync(resolve(repositoryRoot, path)), path).toBe(true);
    }
  });

  it("keeps Markdown links resolvable and public documentation portable", () => {
    const unresolved: string[] = [];
    const nonPortable: string[] = [];
    for (const file of publicMarkdownFiles()) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
        const rawTarget = match[1]!.trim().replace(/^<|>$/gu, "").split(/\s+["']/u, 1)[0]!;
        if (/^(?:https?:|mailto:|#)/iu.test(rawTarget)) continue;
        const target = decodeURIComponent(rawTarget.split("#", 1)[0]!);
        if (target.length > 0 && !existsSync(resolve(dirname(file), target))) unresolved.push(`${file}: ${rawTarget}`);
      }
      if (/(?:[A-Z]:\\(?:Band8|Users\\)|AppData|STUDYAI|paper_digest_automation|psychotherapy_digest_automation)/iu.test(content)) {
        nonPortable.push(file);
      }
    }
    expect(unresolved).toEqual([]);
    expect(nonPortable).toEqual([]);
  });

  it("defines verification-only CI for Windows, Ubuntu, and Chromium", () => {
    const workflowPath = resolve(repositoryRoot, ".github/workflows/ci.yml");
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("contents: read");
    expect(workflow).toMatch(/windows-latest/u);
    expect(workflow).toMatch(/ubuntu-latest/u);
    expect(workflow).toContain("npm run verify:release");
    expect(workflow).toContain("npm run test:e2e");
    expect(workflow).toContain("playwright install --with-deps chromium");
    expect(workflow).not.toMatch(/\b(?:publish|deploy|release)\s*:/iu);
  });

  it("ignores local release artifacts and contains no telemetry dependency", () => {
    const gitignore = readFileSync(resolve(repositoryRoot, ".gitignore"), "utf8");
    expect(gitignore).toMatch(/^\.release\/$/mu);
    expect(gitignore).toMatch(/^\.venv\/$/mu);
    const packageMetadata = readFileSync(resolve(repositoryRoot, "package.json"), "utf8");
    expect(packageMetadata).not.toMatch(/(?:analytics|mixpanel|segment|sentry|telemetry)/iu);
    expect(statSync(resolve(repositoryRoot, "LICENSE")).size).toBeGreaterThan(10_000);
  });

  it("removes stale hashed Web assets on every production build", () => {
    const viteConfig = readFileSync(resolve(repositoryRoot, "web/vite.config.ts"), "utf8");
    expect(viteConfig).toMatch(/emptyOutDir:\s*true/u);
  });
});
