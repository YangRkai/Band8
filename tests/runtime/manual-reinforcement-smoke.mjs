import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Band8Runtime } from "../../dist/src/runtime/runtime.js";
import { storageKey } from "../../dist/src/storage/workspace.js";

const directory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(directory, "../..");
const fixtureRoot = join(directory, "fixtures", "writing-golden");
const packageA = JSON.parse(readFileSync(join(fixtureRoot, "package-a.json"), "utf8"));
const packageBText = readFileSync(join(fixtureRoot, "package-b.json"), "utf8");
const draft = readFileSync(join(fixtureRoot, "draft.txt"), "utf8").trimEnd();
const revision = readFileSync(join(fixtureRoot, "revision.txt"), "utf8").trimEnd();
const transfer = readFileSync(join(fixtureRoot, "transfer.txt"), "utf8").trimEnd();
const temporaryRoot = join(repositoryRoot, ".tmp");
mkdirSync(temporaryRoot, { recursive: true });
const workspacePath = mkdtempSync(join(temporaryRoot, "phase1c-reinforcement-"));
const artifactIds = ["artifact-writing-golden-draft", "artifact-writing-golden-revision", "artifact-writing-golden-transfer"];
let event = 0;
let artifact = 0;
let second = 0;
const dependencies = {
  learnerId: "learner-phase1c-dogfood",
  eventIdFactory: () => `event-phase1c-dogfood-${++event}`,
  artifactIdFactory: () => artifactIds[artifact++] ?? `artifact-phase1c-extra-${artifact}`,
  now: () => new Date(Date.UTC(2026, 7, 27, 13, 0, second++)).toISOString(),
};
const hashFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

const runtime = Band8Runtime.open({ repositoryRoot, workspacePath, ...dependencies });
runtime.configureLearningTimezone("Asia/Shanghai");
runtime.importPackage(JSON.stringify(packageA));
const priorSessionId = "session-phase1c-writing-a";
runtime.createSession(packageA.package_id, priorSessionId);
runtime.startSession(priorSessionId);
runtime.completeCurrentActivity(priorSessionId);
runtime.completeCurrentActivity(priorSessionId);
runtime.completeCurrentActivity(priorSessionId, { text: draft });
const attached = runtime.attachContinuation(priorSessionId, packageBText);
const beforeMission = runtime.mission(attached.sessionId);
runtime.startSession(attached.sessionId);
runtime.completeCurrentActivity(attached.sessionId);
runtime.completeCurrentActivity(attached.sessionId, { text: revision });
runtime.completeCurrentActivity(attached.sessionId, { text: transfer });

const sessionRoot = join(workspacePath, "sessions", storageKey(attached.sessionId));
const eventPath = join(sessionRoot, "events.ndjson");
const resultPath = join(sessionRoot, "result.json");
const rawBefore = { events: hashFile(eventPath), result: hashFile(resultPath) };
const evaluation = runtime.evaluateReinforcement(attached.sessionId);
const reveal = runtime.reveal(attached.sessionId);
const rawAfter = { events: hashFile(eventPath), result: hashFile(resultPath) };
const summary = {
  before_mission: beforeMission.status,
  after_mission: evaluation.mission.status,
  eligible: evaluation.eligible.map((item) => item.event_type),
  rejected: evaluation.rejected,
  primary: reveal.primary_event?.event_type ?? null,
  secondary: reveal.supporting_events.map((item) => item.event_type),
  evidence_refs: reveal.evidence_refs,
  qualification_change: reveal.qualification_change,
  subjective_transfer_treatment: evaluation.rejected.some((item) => item.event_type === "TRANSFER_CONFIRMED")
    ? "REJECTED_WITHOUT_AUTHORITATIVE_SUCCESS"
    : "UNEXPECTEDLY_ELIGIBLE",
  raw_evidence_unchanged: rawBefore.events === rawAfter.events && rawBefore.result === rawAfter.result,
  push: "NO",
  deploy: "NO",
};
console.log(JSON.stringify(summary, null, 2));
