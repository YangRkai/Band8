import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { executeCli } from "../../src/cli/index.js";
import type { RunningBand8Server } from "../../src/server/server.js";
import { storageKey } from "../../src/storage/workspace.js";

const repositoryRoot = resolve(process.cwd());
const packagePath = resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/training-package.json");
const protectedPath = resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/protected-evaluation.json");
const writingPackageAPath = resolve(repositoryRoot, "tests/protocol/fixtures/adversarial/writing-checkpoint/package-a.json");
const writingPackageBPath = resolve(repositoryRoot, "tests/protocol/fixtures/adversarial/writing-checkpoint/package-b.json");
const temporaryPaths: string[] = [];

function workspace(): string {
  const temporaryRoot = join(repositoryRoot, ".tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  const path = mkdtempSync(join(temporaryRoot, "band8-cli-"));
  temporaryPaths.push(path);
  return path;
}

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("headless CLI harness", () => {
  it("starts the loopback web shell with explicit no-open lifecycle options", async () => {
    const path = workspace();
    const output: string[] = [];
    let received: Record<string, any> | undefined;
    let waitedForShutdown = false;
    let closed = false;
    const dependencies = {
      repositoryRoot,
      write: (value: string) => output.push(value),
      startServer: async (options: Record<string, any>) => {
        received = options;
        return { host: "127.0.0.1" as const, port: 43127, url: "http://127.0.0.1:43127", close: async () => { closed = true; } };
      },
      waitForShutdown: async (running: RunningBand8Server) => { waitedForShutdown = true; await running.close(); },
      openBrowser: () => { throw new Error("--no-open must not open a browser"); },
    };

    expect(await executeCli(["--workspace", path, "serve", "--port", "0", "--no-open"], dependencies)).toBe(0);
    expect(received).toMatchObject({ repositoryRoot, workspacePath: path, port: 0 });
    expect(output.join("\n")).toContain("Band8 local server");
    expect(output.join("\n")).toContain(`Workspace:\n${path}`);
    expect(output.join("\n")).toContain("Learning timezone:\nNOT_CONFIGURED");
    expect(output.join("\n")).toContain("Open:\nhttp://127.0.0.1:43127");
    expect(waitedForShutdown).toBe(true);
    expect(closed).toBe(true);
  });

  it("configures and explicitly changes the Runtime learning timezone", async () => {
    const path = workspace();
    const output: string[] = [];
    const epochIds = ["timezone-epoch-cli-one", "timezone-epoch-cli-two"];
    let instant = "2026-08-26T00:00:00.000Z";
    const dependencies = {
      repositoryRoot,
      write: (value: string) => output.push(value),
      now: () => instant,
      timezoneEpochIdFactory: () => epochIds.shift()!,
    };

    expect(await executeCli(["--workspace", path, "timezone", "get"], dependencies)).toBe(0);
    expect(output.pop()).toBe("UNCONFIGURED");
    expect(await executeCli(["--workspace", path, "timezone", "set", "Asia/Shanghai"], dependencies)).toBe(0);
    expect(output.pop()).toBe("CONFIGURED Asia/Shanghai timezone-epoch-cli-one");
    instant = "2026-08-27T00:00:00.000Z";
    expect(await executeCli(["--workspace", path, "timezone", "change", "America/Los_Angeles"], dependencies)).toBe(0);
    expect(output.pop()).toBe("CHANGED America/Los_Angeles timezone-epoch-cli-two");
    expect(await executeCli(["--workspace", path, "timezone", "get"], dependencies)).toBe(0);
    expect(JSON.parse(output.pop()!)).toMatchObject({
      learning_timezone: "America/Los_Angeles",
      timezone_epoch_id: "timezone-epoch-cli-two",
    });
  });

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
    await executeCli(["--workspace", path, "timezone", "set", "UTC"], dependencies);
    await executeCli(["--workspace", path, "import", packagePath, "--protected", protectedPath], dependencies);
    const answers = ["", "", "true", "not-given"];
    dependencies.read = async () => answers.shift() ?? "";

    expect(await executeCli(["--workspace", path, "run", "pkg-runtime-reading-001", "--session", "session-cli-golden"], dependencies)).toBe(0);
    const serialized = output.join("\n");
    expect(serialized).toContain("COMPLETED");
    expect(serialized).not.toMatch(/correct_option_ids|scoring_rule|integrity_ref/u);
    expect(JSON.parse(readFileSync(join(path, "registry", "imports.json"), "utf8")).packages).toHaveProperty("pkg-runtime-reading-001");

    output.length = 0;
    expect(await executeCli(["--workspace", path, "reinforce", "evaluate", "session-cli-golden"], dependencies)).toBe(0);
    const reinforcement = JSON.parse(output.at(-1)!) as Record<string, any>;
    expect(reinforcement.eligible.map((item: Record<string, any>) => item.event_type)).toContain("SESSION_COMPLETE");

    output.length = 0;
    expect(await executeCli(["--workspace", path, "reveal", "session-cli-golden"], dependencies)).toBe(0);
    expect(JSON.parse(output.at(-1)!).primary_event.event_type).toBe("MISSION_ADVANCED");

    output.length = 0;
    expect(await executeCli(["--workspace", path, "mission", "session-cli-golden"], dependencies)).toBe(0);
    expect(JSON.parse(output.at(-1)!).status).toBe("VALIDATION_PENDING");
  });

  it("ingests Writing text, exports its checkpoint, and attaches a continuation through CLI adapters", async () => {
    const path = workspace();
    const output: string[] = [];
    let event = 0;
    const draft = "A city should reserve quiet public rooms for learners because shared housing can make concentration difficult. The policy provides a reliable study place, although booking rules are needed so access remains fair.";
    const dependencies = {
      repositoryRoot,
      write: (value: string) => output.push(value),
      read: async () => draft,
      eventIdFactory: () => `event-cli-writing-${++event}`,
      artifactIdFactory: () => "artifact-writing-original-001",
      now: () => "2026-08-26T15:00:00.000Z",
    };

    expect(await executeCli(["--workspace", path, "import", writingPackageAPath], dependencies)).toBe(0);
    expect(await executeCli(["--workspace", path, "run", "pkg-writing-checkpoint-a", "--session", "session-cli-writing"], dependencies)).toBe(0);
    expect(await executeCli(["--workspace", path, "checkpoint", "session-cli-writing"], dependencies)).toBe(0);
    expect(await executeCli(["--workspace", path, "continue", "session-cli-writing", writingPackageBPath], dependencies)).toBe(0);

    const serialized = output.join("\n");
    expect(serialized).toContain("AWAITING_COACH session-cli-writing");
    expect(serialized).toContain("DATA_ONLY");
    expect(serialized).toContain("ATTACHED pkg-writing-checkpoint-b");
    expect(readFileSync(join(path, "artifacts", storageKey("artifact-writing-original-001"), "content.txt"), "utf8")).toBe(draft);
  });
});
