import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createProtocolValidator } from "../../src/protocol/validator.js";
import { AppendOnlyEventStore } from "../../src/storage/event-store.js";
import { PackageImporter } from "../../src/storage/package-importer.js";
import { initializeWorkspace } from "../../src/storage/workspace.js";
import { transitionState } from "../../src/runtime/state-machine.js";

const repositoryRoot = resolve(process.cwd());
const packageText = readFileSync(
  resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/training-package.json"),
  "utf8",
);
const protectedText = readFileSync(
  resolve(repositoryRoot, "tests/runtime/fixtures/reading-golden/protected-evaluation.json"),
  "utf8",
);
const workspaces: string[] = [];

function temporaryWorkspace(): string {
  const path = mkdtempSync(join(tmpdir(), "band8-runtime-"));
  workspaces.push(path);
  return path;
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("workspace and package identity", () => {
  it("creates only Runtime-owned workspace boundaries", () => {
    const workspace = initializeWorkspace(temporaryWorkspace());
    expect(Object.keys(workspace.paths).sort()).toEqual([
      "artifacts",
      "coach",
      "packages",
      "protected",
      "registry",
      "reinforcementDecisions",
      "reinforcementLearningDays",
      "reinforcementQualifications",
      "sessions",
      "settings",
    ]);
    expect(Object.values(workspace.paths).every((path) => path.startsWith(workspace.root))).toBe(true);
  });

  it("persists import identity across importer restarts", () => {
    const workspacePath = temporaryWorkspace();
    const validator = createProtocolValidator(repositoryRoot);
    const first = new PackageImporter(initializeWorkspace(workspacePath), validator);
    const imported = first.importFromText(packageText, protectedText);
    expect(imported.status).toBe("IMPORTED");

    const reopened = new PackageImporter(initializeWorkspace(workspacePath), validator);
    const repeated = reopened.importFromText(packageText, protectedText);
    expect(repeated.status).toBe("IDEMPOTENT");
    expect(reopened.list()).toHaveLength(1);
  });

  it("rejects the same package ID with different canonical content", () => {
    const workspace = initializeWorkspace(temporaryWorkspace());
    const importer = new PackageImporter(workspace, createProtocolValidator(repositoryRoot));
    importer.importFromText(packageText, protectedText);
    const changed = JSON.parse(packageText) as Record<string, any>;
    changed.session_intent.objective = "Collision content";

    expect(() => importer.importFromText(JSON.stringify(changed))).toThrow(/collision/u);
    expect(importer.list()).toHaveLength(1);
  });

  it("rejects an accepted package whose stored bytes no longer match its registered identity", () => {
    const workspace = initializeWorkspace(temporaryWorkspace());
    const importer = new PackageImporter(workspace, createProtocolValidator(repositoryRoot));
    importer.importFromText(packageText, protectedText);
    const record = importer.record("pkg-runtime-reading-001");
    const changed = JSON.parse(packageText) as Record<string, any>;
    changed.session_intent.objective = "Tampered after import";
    writeFileSync(record.package_file, `${JSON.stringify(changed)}\n`, "utf8");

    expect(() => importer.loadPackage("pkg-runtime-reading-001")).toThrow(/integrity|hash/iu);
  });

  it("rejects an accepted protected evaluation whose stored bytes no longer match the package reference", () => {
    const workspace = initializeWorkspace(temporaryWorkspace());
    const importer = new PackageImporter(workspace, createProtocolValidator(repositoryRoot));
    importer.importFromText(packageText, protectedText);
    const record = importer.record("pkg-runtime-reading-001");
    const changed = JSON.parse(protectedText) as Record<string, any>;
    changed.entries[0].correct_option_ids = ["false"];
    writeFileSync(record.protected_file!, `${JSON.stringify(changed)}\n`, "utf8");

    expect(() => importer.loadProtected("pkg-runtime-reading-001")).toThrow(/integrity|hash/iu);
  });
});

describe("session state machine", () => {
  it("accepts only frozen state transitions", () => {
    expect(transitionState("CREATED", "READY")).toBe("READY");
    expect(transitionState("READY", "RUNNING")).toBe("RUNNING");
    expect(transitionState("RUNNING", "SUSPENDED")).toBe("SUSPENDED");
    expect(transitionState("SUSPENDED", "RUNNING")).toBe("RUNNING");
    expect(transitionState("RUNNING", "AWAITING_COACH")).toBe("AWAITING_COACH");
    expect(transitionState("AWAITING_COACH", "READY")).toBe("READY");
    expect(transitionState("RUNNING", "COMPLETED")).toBe("COMPLETED");
    expect(transitionState("SUSPENDED", "ABORTED")).toBe("ABORTED");
    expect(transitionState("CREATED", "QUARANTINED")).toBe("QUARANTINED");
    expect(() => transitionState("CREATED", "RUNNING")).toThrow(/illegal session transition/u);
    expect(() => transitionState("COMPLETED", "RUNNING")).toThrow(/illegal session transition/u);
  });
});

describe("append-only event storage", () => {
  it("validates the full candidate prefix before durable append and does not consume sequence on failure", () => {
    const workspace = initializeWorkspace(temporaryWorkspace());
    const validator = createProtocolValidator(repositoryRoot);
    const packageDocument = JSON.parse(packageText);
    let id = 0;
    const store = new AppendOnlyEventStore(workspace, validator, () => `event-runtime-${++id}`);
    const context = {
      sessionId: "session-runtime-events",
      runId: packageDocument.run_id,
      segmentId: packageDocument.segment_id,
      packageId: packageDocument.package_id,
    };

    expect(
      store.append(context, packageDocument, {
        eventType: "session_started",
        activityId: null,
        timestamp: "2026-08-26T14:00:00Z",
        monotonicOffsetMs: 0,
        payload: { run_id: context.runId, segment_id: context.segmentId, mode: "training" },
      }).sequence_number,
    ).toBe(1);
    expect(() =>
      store.append(context, packageDocument, {
        eventType: "answer_submitted",
        activityId: "activity-missing",
        timestamp: "2026-08-26T14:00:01Z",
        monotonicOffsetMs: 1000,
        payload: { attempt_id: "attempt-missing", response_kind: "selection", option_ids: ["true"] },
      }),
    ).toThrow();
    expect(
      store.append(context, packageDocument, {
        eventType: "session_abandoned",
        activityId: null,
        timestamp: "2026-08-26T14:00:02Z",
        monotonicOffsetMs: 2000,
        payload: { reason: "test" },
      }).sequence_number,
    ).toBe(2);
    expect(store.read(context.sessionId)).toHaveLength(2);
  });
});
