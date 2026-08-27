import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Band8Runtime } from "../../src/runtime/runtime.js";

const repositoryRoot = resolve(process.cwd());
const readingPackage = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/training-package.json"), "utf8");
const readingProtected = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/protected-evaluation.json"), "utf8");
const writingA = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/writing-golden/package-a.json"), "utf8");
const writingB = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/writing-golden/package-b.json"), "utf8");
const draft = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/writing-golden/draft.txt"), "utf8");
const revision = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/writing-golden/revision.txt"), "utf8");
const transfer = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/writing-golden/transfer.txt"), "utf8");
const workspaces: string[] = [];

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "band8-reinforcement-golden-"));
  workspaces.push(path);
  return path;
}

function open(path: string, artifactIds: string[] = []): Band8Runtime {
  let event = 0;
  let second = 0;
  const runtime = Band8Runtime.open({
    repositoryRoot,
    workspacePath: path,
    learnerId: "learner-golden",
    eventIdFactory: () => `event-reinforcement-golden-${++event}`,
    artifactIdFactory: () => artifactIds.shift() ?? "artifact-unexpected",
    now: () => new Date(Date.UTC(2026, 7, 27, 12, 0, second++)).toISOString(),
  });
  if (runtime.learningTimezone() === undefined) runtime.configureLearningTimezone("UTC");
  return runtime;
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("reinforcement golden fixtures", () => {
  it("projects ordinary Reading completion without fabricating a pattern breakthrough", () => {
    const runtime = open(workspace());
    runtime.importPackage(readingPackage, readingProtected);
    runtime.createSession("pkg-runtime-reading-001", "session-reinforcement-reading-golden");
    runtime.startSession("session-reinforcement-reading-golden");
    runtime.completeCurrentActivity("session-reinforcement-reading-golden");
    runtime.completeCurrentActivity("session-reinforcement-reading-golden");
    runtime.completeCurrentActivity("session-reinforcement-reading-golden", { optionIds: ["true"] });
    runtime.completeCurrentActivity("session-reinforcement-reading-golden", { optionIds: ["not-given"] });

    const evaluation = runtime.evaluateReinforcement("session-reinforcement-reading-golden");
    expect(evaluation.eligible.map((item) => item.event_type)).toEqual([
      "SESSION_COMPLETE",
      "MISSION_ADVANCED",
      "STREAK_EXTENDED",
    ]);
    expect(evaluation.rejected).toContainEqual({ event_type: "PATTERN_BROKEN", reason: "complete_pattern_chain_not_proven" });
    expect(runtime.reveal("session-reinforcement-reading-golden").primary_event?.event_type).toBe("MISSION_ADVANCED");
  });

  it("dogfoods the Writing golden loop without converting subjective artifacts into transfer success", () => {
    const runtime = open(workspace(), [
      "artifact-writing-golden-draft",
      "artifact-writing-golden-revision",
      "artifact-writing-golden-transfer",
    ]);
    runtime.importPackage(writingA);
    runtime.createSession("pkg-writing-golden-a", "session-writing-reinforcement-a");
    runtime.startSession("session-writing-reinforcement-a");
    runtime.completeCurrentActivity("session-writing-reinforcement-a");
    runtime.completeCurrentActivity("session-writing-reinforcement-a");
    runtime.completeCurrentActivity("session-writing-reinforcement-a", { text: draft });
    const attached = runtime.attachContinuation("session-writing-reinforcement-a", writingB);
    expect(runtime.mission(attached.sessionId).status).toBe("OPEN");
    expect(runtime.mission("run-writing-golden").status).toBe("OPEN");
    expect(runtime.getSession(attached.sessionId).state).toBe("READY");
    runtime.startSession(attached.sessionId);
    runtime.completeCurrentActivity(attached.sessionId);
    runtime.completeCurrentActivity(attached.sessionId, { text: revision });
    runtime.completeCurrentActivity(attached.sessionId, { text: transfer });

    const evaluation = runtime.evaluateReinforcement(attached.sessionId);
    expect(evaluation.eligible.map((item) => item.event_type)).toEqual([
      "SESSION_COMPLETE",
      "MISSION_ADVANCED",
      "STREAK_EXTENDED",
    ]);
    expect(evaluation.rejected).toEqual(expect.arrayContaining([
      { event_type: "TRANSFER_CONFIRMED", reason: "changed_material_not_proven" },
      { event_type: "PATTERN_BROKEN", reason: "complete_pattern_chain_not_proven" },
    ]));
    expect(evaluation.mission.status).toBe("EVIDENCE_PENDING");
    expect(runtime.reveal(attached.sessionId).primary_event?.event_type).toBe("MISSION_ADVANCED");
  });
});
