import { appendFileSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Band8Runtime, UnsupportedRuntimePrimitiveError } from "../../src/runtime/runtime.js";
import { storageKey } from "../../src/storage/workspace.js";

const repositoryRoot = resolve(process.cwd());
const packageText = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/training-package.json"), "utf8");
const protectedText = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/protected-evaluation.json"), "utf8");
const workspaces: string[] = [];

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "band8-golden-"));
  workspaces.push(path);
  return path;
}

function dependencies() {
  let event = 0;
  let second = 0;
  return {
    eventIdFactory: () => `event-golden-${++event}`,
    now: () => new Date(Date.UTC(2026, 7, 26, 14, 0, second++)).toISOString(),
  };
}

function open(path: string, deps = dependencies()): Band8Runtime {
  return Band8Runtime.open({ repositoryRoot, workspacePath: path, ...deps });
}

function importAndStart(runtime: Band8Runtime, sessionId = "session-runtime-golden") {
  runtime.importPackage(packageText, protectedText);
  expect(runtime.createSession("pkg-runtime-reading-001", sessionId).state).toBe("READY");
  expect(runtime.startSession(sessionId).state).toBe("RUNNING");
}

function completeGolden(runtime: Band8Runtime, sessionId = "session-runtime-golden") {
  runtime.completeCurrentActivity(sessionId);
  runtime.completeCurrentActivity(sessionId);
  runtime.completeCurrentActivity(sessionId, { optionIds: ["true"] });
  return runtime.completeCurrentActivity(sessionId, { optionIds: ["not-given"] });
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("protected learner projection", () => {
  it("never serializes protected answers, scoring rules, hidden paths, or Coach data", () => {
    const path = workspace();
    const runtime = open(path);
    importAndStart(runtime);
    runtime.completeCurrentActivity("session-runtime-golden");
    runtime.completeCurrentActivity("session-runtime-golden");

    const serialized = JSON.stringify(runtime.currentActivity("session-runtime-golden"));
    expect(serialized).toContain("activity-runtime-select-1");
    expect(serialized).not.toMatch(/correct_option_ids|scoring_rule|integrity_ref|package_file|protected_file|coach/iu);
  });
});

describe("Reading Golden Run", () => {
  it("validates, imports, executes, evaluates, completes, reopens, and revalidates evidence", () => {
    const path = workspace();
    const deps = dependencies();
    const runtime = open(path, deps);
    importAndStart(runtime);

    const completion = completeGolden(runtime);
    expect(completion.state).toBe("COMPLETED");
    expect(completion.result?.objective_results.map((item: any) => item.outcome)).toEqual([
      "successful",
      "successful",
    ]);
    expect(runtime.inspectSession("session-runtime-golden").status).toBe("AUTHORITATIVE");

    const reopened = open(path, deps);
    expect(reopened.inspectSession("session-runtime-golden").status).toBe("AUTHORITATIVE");
    expect(reopened.getSession("session-runtime-golden").state).toBe("COMPLETED");
  });

  it("survives restart after the first SELECT and makes duplicate resume a no-op", () => {
    const path = workspace();
    const deps = dependencies();
    const firstRuntime = open(path, deps);
    importAndStart(firstRuntime, "session-runtime-crash");
    firstRuntime.completeCurrentActivity("session-runtime-crash");
    firstRuntime.completeCurrentActivity("session-runtime-crash");
    firstRuntime.completeCurrentActivity("session-runtime-crash", { optionIds: ["true"] });

    const restarted = open(path, deps);
    expect(restarted.inspectSession("session-runtime-crash").status).toBe("VALID_INCOMPLETE");
    expect(restarted.resumeSession("session-runtime-crash", "resume-operation-crash").status).toBe("RESUMED");
    expect(restarted.resumeSession("session-runtime-crash", "resume-operation-crash").status).toBe("IDEMPOTENT");
    const completion = restarted.completeCurrentActivity("session-runtime-crash", { optionIds: ["not-given"] });
    expect(completion.state).toBe("COMPLETED");
    const resumes = restarted.events("session-runtime-crash").filter((event: any) => event.event_type === "session_resumed");
    expect(resumes).toHaveLength(1);
  });

  it("rebuilds a missing result deterministically and quarantines a result whose raw evidence is invalid", () => {
    const path = workspace();
    const deps = dependencies();
    const runtime = open(path, deps);
    importAndStart(runtime, "session-runtime-rebuild");
    completeGolden(runtime, "session-runtime-rebuild");
    const sessionDirectory = join(path, "sessions", storageKey("session-runtime-rebuild"));
    unlinkSync(join(sessionDirectory, "result.json"));

    expect(runtime.inspectSession("session-runtime-rebuild").status).toBe("REBUILD_REQUIRED");
    const first = runtime.rebuildResult("session-runtime-rebuild");
    const second = runtime.rebuildResult("session-runtime-rebuild");
    expect(second).toEqual(first);

    appendFileSync(join(sessionDirectory, "events.ndjson"), "{partial", "utf8");
    const reopened = open(path, deps);
    expect(reopened.inspectSession("session-runtime-rebuild").status).toBe("QUARANTINED");
    expect(reopened.getSession("session-runtime-rebuild").state).toBe("QUARANTINED");
    expect(reopened.getSession("session-runtime-rebuild").quarantine_reason).toMatch(/event/iu);
  });

  it("quarantines a derived result that contradicts protected evaluation", () => {
    const path = workspace();
    const runtime = open(path);
    importAndStart(runtime, "session-runtime-tampered-result");
    completeGolden(runtime, "session-runtime-tampered-result");
    const resultPath = join(path, "sessions", storageKey("session-runtime-tampered-result"), "result.json");
    const result = JSON.parse(readFileSync(resultPath, "utf8")) as Record<string, any>;
    result.objective_results[0].outcome = "unsuccessful";
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`, "utf8");

    expect(runtime.inspectSession("session-runtime-tampered-result").status).toBe("QUARANTINED");
    expect(runtime.getSession("session-runtime-tampered-result").quarantine_reason).toMatch(/result/iu);
  });

  it("fails explicitly when a schema-valid package reaches an unimplemented primitive", () => {
    const path = workspace();
    const runtime = open(path);
    const unsupported = JSON.parse(packageText) as Record<string, any>;
    unsupported.package_id = "pkg-runtime-unsupported";
    unsupported.protected_evaluation_ref = null;
    const activity = unsupported.activities[0];
    activity.type = "MATCH";
    activity.config = {
      left_items: [{ item_id: "left-one", label: "Left" }, { item_id: "left-two", label: "Other" }],
      right_items: [{ item_id: "right-one", label: "Right" }, { item_id: "right-two", label: "Other" }],
    };
    activity.output_contract = { kind: "mapping", artifact_type: null };
    runtime.importPackage(JSON.stringify(unsupported));
    runtime.createSession("pkg-runtime-unsupported", "session-runtime-unsupported");
    runtime.startSession("session-runtime-unsupported");

    expect(() => runtime.completeCurrentActivity("session-runtime-unsupported")).toThrow(
      UnsupportedRuntimePrimitiveError,
    );
    expect(() => runtime.completeCurrentActivity("session-runtime-unsupported")).toThrow(
      /UNSUPPORTED_RUNTIME_PRIMITIVE/u,
    );
  });
});
