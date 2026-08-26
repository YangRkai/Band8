import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson, parseJsonStrict } from "../protocol/canonical.js";
import type { SessionState } from "../runtime/state-machine.js";
import { writeTextAtomic } from "./atomic.js";
import type { RuntimeWorkspace } from "./workspace.js";
import { storageKey } from "./workspace.js";

export interface SessionMetadata {
  session_id: string;
  run_id: string;
  segment_id: string;
  package_id: string;
  state: SessionState;
  current_activity_index: number;
  completed_activity_ids: string[];
  checkpoint_id?: string;
  prior_session_id?: string;
  continuation_session_id?: string;
  quarantine_reason?: string;
}

export class SessionStore {
  constructor(private readonly workspace: RuntimeWorkspace) {}

  exists(sessionId: string): boolean {
    return existsSync(this.metadataPath(sessionId));
  }

  read(sessionId: string): SessionMetadata {
    if (!this.exists(sessionId)) throw new Error(`session does not exist: ${sessionId}`);
    return parseJsonStrict(readFileSync(this.metadataPath(sessionId), "utf8")) as SessionMetadata;
  }

  write(metadata: SessionMetadata): void {
    writeTextAtomic(this.metadataPath(metadata.session_id), `${canonicalJson(metadata)}\n`);
  }

  readResult(sessionId: string): Record<string, any> | undefined {
    const path = this.resultPath(sessionId);
    return existsSync(path) ? parseJsonStrict(readFileSync(path, "utf8")) as Record<string, any> : undefined;
  }

  writeResult(sessionId: string, result: Record<string, any>): void {
    writeTextAtomic(this.resultPath(sessionId), `${canonicalJson(result)}\n`);
  }

  directory(sessionId: string): string {
    return join(this.workspace.paths.sessions, storageKey(sessionId));
  }

  metadataPath(sessionId: string): string {
    return join(this.directory(sessionId), "session.json");
  }

  resultPath(sessionId: string): string {
    return join(this.directory(sessionId), "result.json");
  }
}
