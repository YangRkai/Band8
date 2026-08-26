import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { Band8Runtime } from "../../src/runtime/runtime.js";
import { continuationSessionId } from "../../src/runtime/continuation.js";
import { storageKey } from "../../src/storage/workspace.js";

type Document = Record<string, any>;

const repositoryRoot = resolve(process.cwd());
const fixtureRoot = resolve(repositoryRoot, "tests/protocol/fixtures/adversarial/writing-checkpoint");
const packageA = JSON.parse(readFileSync(join(fixtureRoot, "package-a.json"), "utf8")) as Document;
const packageBText = readFileSync(join(fixtureRoot, "package-b.json"), "utf8");
const workspaces: string[] = [];
const draft = "A city should reserve quiet public rooms for learners because shared housing can make concentration difficult. The policy would give residents a reliable place to study, although the city would need booking rules so that access remains fair.";

function workspace(): string {
  const path = mkdtempSync(join(tmpdir(), "band8-continuation-"));
  workspaces.push(path);
  return path;
}

function dependencies() {
  let event = 0;
  let artifact = 0;
  let second = 0;
  return {
    eventIdFactory: () => `event-continuation-${++event}`,
    artifactIdFactory: () => artifact++ === 0 ? "artifact-writing-original-001" : `artifact-continuation-${artifact}`,
    now: () => new Date(Date.UTC(2026, 7, 26, 15, 0, second++)).toISOString(),
  };
}

function checkpointRuntime(path: string, deps = dependencies()): Band8Runtime {
  const runtime = Band8Runtime.open({ repositoryRoot, workspacePath: path, ...deps });
  runtime.importPackage(JSON.stringify(packageA));
  runtime.createSession(packageA.package_id, "session-writing-prior");
  runtime.startSession("session-writing-prior");
  runtime.completeCurrentActivity("session-writing-prior", { text: draft });
  return runtime;
}

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

afterEach(() => {
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("External Coach file exchange", () => {
  it("exports a DATA-only bundle with relative references to exact checkpoint evidence", () => {
    const path = workspace();
    const runtime = checkpointRuntime(path);
    const exported = runtime.exportCheckpoint("session-writing-prior");
    const bundle = JSON.parse(readFileSync(exported.bundlePath, "utf8")) as Document;

    expect(bundle).toMatchObject({
      bundle_type: "band8_coach_input",
      trust_classification: "DATA_ONLY",
      checkpoint_id: "checkpoint-writing-001",
      relevant_activity_refs: ["act-writing-original"],
    });
    expect(bundle.records.every((record: Document) => record.trust_classification === "data")).toBe(true);
    expect(bundle.records.every((record: Document) => !/^[A-Za-z]:|^\\\\|^\//u.test(record.relative_path))).toBe(true);
    expect(bundle.records.map((record: Document) => record.record_id)).toContain("artifact-writing-original-001");
    expect(runtime.readArtifactText("artifact-writing-original-001")).toBe(draft);
  });
});

describe("continuation attachment", () => {
  it("binds one validated continuation idempotently without mutating prior evidence", () => {
    const path = workspace();
    const deps = dependencies();
    const runtime = checkpointRuntime(path, deps);
    runtime.exportCheckpoint("session-writing-prior");
    const eventPath = join(path, "sessions", storageKey("session-writing-prior"), "events.ndjson");
    const before = fileHash(eventPath);

    const attached = runtime.attachContinuation("session-writing-prior", packageBText);
    expect(attached.status).toBe("ATTACHED");
    expect(runtime.attachContinuation("session-writing-prior", packageBText)).toEqual({
      status: "IDEMPOTENT",
      sessionId: attached.sessionId,
      packageId: "pkg-writing-checkpoint-b",
    });
    expect(fileHash(eventPath)).toBe(before);
    expect(runtime.getSession("session-writing-prior").state).toBe("AWAITING_COACH");
    expect(runtime.getSession(attached.sessionId)).toMatchObject({
      state: "READY",
      prior_session_id: "session-writing-prior",
      package_id: "pkg-writing-checkpoint-b",
    });
  });

  it("rejects wrong evidence, reused segment, package collision, and conflicting checkpoint binding", () => {
    const path = workspace();
    const runtime = checkpointRuntime(path);
    runtime.exportCheckpoint("session-writing-prior");

    const wrongEvidence = JSON.parse(packageBText) as Document;
    wrongEvidence.continuation.required_evidence_refs = ["artifact-wrong"];
    wrongEvidence.available_evidence_refs = ["artifact-wrong"];
    expect(() => runtime.attachContinuation("session-writing-prior", JSON.stringify(wrongEvidence))).toThrow(/evidence|unavailable/iu);

    const reused = JSON.parse(packageBText) as Document;
    reused.segment_id = packageA.segment_id;
    expect(() => runtime.attachContinuation("session-writing-prior", JSON.stringify(reused))).toThrow(/segment/iu);

    const fabricated = JSON.parse(packageBText) as Document;
    fabricated.available_evidence_refs.push("artifact-fabricated");
    fabricated.activities[0].relationships.prior_evidence_refs.push("artifact-fabricated");
    expect(() => runtime.attachContinuation("session-writing-prior", JSON.stringify(fabricated))).toThrow(/evidence|unavailable/iu);

    const mismatchedSource = JSON.parse(packageBText) as Document;
    mismatchedSource.available_evidence_refs.push("event-continuation-3");
    mismatchedSource.activities[0].relationships.source_output_ref = "event-continuation-3";
    expect(() => runtime.attachContinuation("session-writing-prior", JSON.stringify(mismatchedSource))).toThrow(/source|artifact|attempt/iu);

    runtime.attachContinuation("session-writing-prior", packageBText);
    const collision = JSON.parse(packageBText) as Document;
    collision.session_intent.objective = "different canonical package content";
    expect(() => runtime.attachContinuation("session-writing-prior", JSON.stringify(collision))).toThrow(/collision/iu);

    const conflicting = JSON.parse(packageBText) as Document;
    conflicting.package_id = "pkg-writing-checkpoint-conflict";
    expect(() => runtime.attachContinuation("session-writing-prior", JSON.stringify(conflicting))).toThrow(/checkpoint.*bound/iu);
  });

  it("survives restart after attachment with deterministic next activity and no prior replay", () => {
    const path = workspace();
    const deps = dependencies();
    const runtime = checkpointRuntime(path, deps);
    runtime.exportCheckpoint("session-writing-prior");
    const priorEventCount = runtime.events("session-writing-prior").length;
    const attached = runtime.attachContinuation("session-writing-prior", packageBText);

    const reopened = Band8Runtime.open({ repositoryRoot, workspacePath: path, ...deps });
    expect(reopened.continuation("session-writing-prior")).toMatchObject({ continuation_session_id: attached.sessionId });
    expect(reopened.events("session-writing-prior")).toHaveLength(priorEventCount);
    reopened.startSession(attached.sessionId);
    expect(reopened.currentActivity(attached.sessionId)).toMatchObject({
      activity_id: "act-writing-revision",
      type: "TEXT_RESPONSE",
    });
  });

  it("rejects a bound continuation when prior artifact bytes change", () => {
    const path = workspace();
    const runtime = checkpointRuntime(path);
    runtime.exportCheckpoint("session-writing-prior");
    runtime.attachContinuation("session-writing-prior", packageBText);
    writeFileSync(join(path, "artifacts", storageKey("artifact-writing-original-001"), "content.txt"), "tampered", "utf8");

    expect(() => runtime.continuation("session-writing-prior")).toThrow(/evidence|integrity|authoritative/iu);
  });

  it("heals continuation attachment metadata after intermediate durable writes", () => {
    const path = workspace();
    const runtime = checkpointRuntime(path);
    runtime.exportCheckpoint("session-writing-prior");
    runtime.importPackage(packageBText);
    const childId = continuationSessionId("session-writing-prior", "segment-writing-002");
    runtime.createSession("pkg-writing-checkpoint-b", childId);
    const childPath = join(path, "sessions", storageKey(childId), "session.json");
    const child = JSON.parse(readFileSync(childPath, "utf8")) as Document;
    writeFileSync(childPath, `${JSON.stringify({ ...child, state: "CREATED" })}\n`, "utf8");

    expect(runtime.attachContinuation("session-writing-prior", packageBText)).toMatchObject({ status: "ATTACHED", sessionId: childId });
    expect(runtime.getSession(childId).state).toBe("READY");

    const priorPath = join(path, "sessions", storageKey("session-writing-prior"), "session.json");
    const prior = JSON.parse(readFileSync(priorPath, "utf8")) as Document;
    delete prior.continuation_session_id;
    writeFileSync(priorPath, `${JSON.stringify(prior)}\n`, "utf8");
    expect(runtime.attachContinuation("session-writing-prior", packageBText).status).toBe("IDEMPOTENT");
    expect(runtime.getSession("session-writing-prior").continuation_session_id).toBe(childId);
  });
});
