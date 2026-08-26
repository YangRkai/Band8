import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";

import { canonicalJson, parseJsonStrict } from "../protocol/canonical.js";
import type { ProtocolValidator } from "../protocol/validator.js";
import type { RuntimeWorkspace } from "./workspace.js";
import { storageKey } from "./workspace.js";

type Document = Record<string, any>;

export interface EventContext {
  sessionId: string;
  runId: string;
  segmentId: string;
  packageId: string;
}

export interface EventDetails {
  eventType: string;
  activityId: string | null;
  timestamp: string;
  monotonicOffsetMs: number;
  payload: Document;
}

export class AppendOnlyEventStore {
  constructor(
    private readonly workspace: RuntimeWorkspace,
    private readonly validator: ProtocolValidator,
    private readonly idFactory: () => string,
  ) {}

  append(context: EventContext, packageDocument: Document, details: EventDetails): Document {
    const existing = this.read(context.sessionId);
    const event: Document = {
      schema_version: "0.1.0",
      protocol_version: "0.1.0",
      event_id: this.idFactory(),
      event_type: details.eventType,
      session_id: context.sessionId,
      run_id: context.runId,
      segment_id: context.segmentId,
      package_id: context.packageId,
      activity_id: details.activityId,
      timestamp: details.timestamp,
      monotonic_offset_ms: details.monotonicOffsetMs,
      sequence_number: existing.length + 1,
      payload: details.payload,
    };
    const candidate = [...existing, event];
    const terminal = new Set(["session_completed", "session_abandoned", "session_quarantined", "coach_checkpoint_reached"]);
    this.validator.validateEventStream(candidate, {
      packageDocument,
      mode: terminal.has(details.eventType) ? "complete" : "prefix",
    });
    const path = this.path(context.sessionId);
    mkdirSync(dirname(path), { recursive: true });
    const handle = openSync(path, "a");
    try {
      const bytes = Buffer.from(`${canonicalJson(event)}\n`, "utf8");
      writeSync(handle, bytes, 0, bytes.length);
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    return event;
  }

  read(sessionId: string): Document[] {
    const path = this.path(sessionId);
    if (!existsSync(path)) return [];
    const text = readFileSync(path, "utf8");
    const lines = text.split(/\r?\n/u);
    if (lines.at(-1) !== "") throw new Error("event store ends with a partial JSON line");
    return lines.slice(0, -1).filter((line) => line.length > 0).map((line) => parseJsonStrict(line) as Document);
  }

  path(sessionId: string): string {
    return join(this.workspace.paths.sessions, storageKey(sessionId), "events.ndjson");
  }
}
