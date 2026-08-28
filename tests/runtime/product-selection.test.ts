import { mkdtempSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Band8Runtime } from "../../src/runtime/runtime.js";
import { storageKey } from "../../src/storage/workspace.js";

const repositoryRoot = resolve(process.cwd());
const reading = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/training-package.json"), "utf8");
const readingProtected = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/protected-evaluation.json"), "utf8");
const writing = readFileSync(resolve(repositoryRoot, "tests/runtime/fixtures/writing-golden/package-a.json"), "utf8");
const workspaces: string[] = [];

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "band8-product-selection-"));
  workspaces.push(path);
  return path;
}

function open(path: string): Band8Runtime {
  let tick = 0;
  return Band8Runtime.open({
    repositoryRoot,
    workspacePath: path,
    now: () => new Date(Date.UTC(2026, 7, 27, 12, 0, tick++)).toISOString(),
  });
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Runtime-owned active product selection", () => {
  it("persists the explicitly selected chain instead of re-guessing from package import timestamps", () => {
    const path = workspace();
    const runtime = open(path);
    runtime.importPackage(reading, readingProtected);
    runtime.importPackage(writing);
    runtime.createSession("pkg-runtime-reading-001", "session-reading-ready");
    runtime.createSession("pkg-writing-golden-a", "session-writing-ready");

    expect(runtime.training()).toMatchObject({ session_id: "session-writing-ready", package_id: "pkg-writing-golden-a", state: "READY" });
    expect(runtime.beginTraining()).toMatchObject({ session_id: "session-writing-ready", package_id: "pkg-writing-golden-a", state: "RUNNING" });
    expect(open(path).training()).toMatchObject({ session_id: "session-writing-ready", package_id: "pkg-writing-golden-a", state: "RUNNING" });
  });

  it("keeps a runnable active chain selected when a standalone package is imported", () => {
    const path = workspace();
    const runtime = open(path);
    runtime.importPackage(reading, readingProtected);
    runtime.createSession("pkg-runtime-reading-001", "session-reading-running");
    runtime.startSession("session-reading-running");
    runtime.importPackage(writing);

    expect(runtime.training()).toMatchObject({ session_id: "session-reading-running", package_id: "pkg-runtime-reading-001", state: "RUNNING" });
    expect(open(path).training()).toMatchObject({ session_id: "session-reading-running", package_id: "pkg-runtime-reading-001", state: "RUNNING" });
  });

  it("moves from a terminal active session to a newly imported eligible package", () => {
    const path = workspace();
    const runtime = open(path);
    runtime.importPackage(reading, readingProtected);
    runtime.createSession("pkg-runtime-reading-001", "session-reading-completed");
    runtime.startSession("session-reading-completed");
    runtime.completeCurrentActivity("session-reading-completed");
    runtime.completeCurrentActivity("session-reading-completed");
    runtime.completeCurrentActivity("session-reading-completed", { optionIds: ["true"] });
    runtime.completeCurrentActivity("session-reading-completed", { optionIds: ["not-given"] });
    runtime.importPackage(writing);

    expect(runtime.training()).toMatchObject({ session_id: null, package_id: "pkg-writing-golden-a", state: "READY_TO_START" });
    expect(open(path).training()).toMatchObject({ session_id: null, package_id: "pkg-writing-golden-a", state: "READY_TO_START" });
  });

  it("does not consume the authoritative evidence clock while persisting or reconciling product selection", () => {
    const path = workspace();
    let tick = 0;
    const runtime = Band8Runtime.open({
      repositoryRoot,
      workspacePath: path,
      eventIdFactory: () => `event-${tick}`,
      now: () => new Date(Date.UTC(2026, 7, 27, 12, 0, tick++)).toISOString(),
    });
    runtime.importPackage(reading, readingProtected);
    runtime.createSession("pkg-runtime-reading-001", "session-reading-clock");
    unlinkSync(join(path, "settings", "product-selection.json"));

    expect(runtime.training()).toMatchObject({ session_id: "session-reading-clock", state: "READY" });
    runtime.startSession("session-reading-clock");

    const events = JSON.parse(readFileSync(join(path, "sessions", storageKey("session-reading-clock"), "events.ndjson"), "utf8").trim());
    expect(events.timestamp).toBe("2026-08-27T12:00:01.000Z");
  });

  it("projects the active package IELTS goal consistently in Today and Progress", () => {
    const path = workspace();
    const runtime = open(path);
    const custom = JSON.parse(writing) as Record<string, any>;
    custom.package_id = "pkg-writing-custom-goal";
    custom.run_id = "run-writing-custom-goal";
    custom.segment_id = "segment-writing-custom-goal";
    custom.learner_goal = {
      overall_target: 8.5,
      section_minimums: { listening: 8, reading: 7.5, writing: 8.5, speaking: 7.5 },
    };
    runtime.importPackage(JSON.stringify(custom));

    expect(runtime.today().goal).toEqual(custom.learner_goal);
    expect(runtime.progress().goal).toEqual(custom.learner_goal);
  });
});
