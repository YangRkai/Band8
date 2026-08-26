import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson, parseJsonStrict } from "../protocol/canonical.js";
import type { ProtocolValidator } from "../protocol/validator.js";
import { writeTextAtomic } from "./atomic.js";
import type { RuntimeWorkspace } from "./workspace.js";
import { storageKey } from "./workspace.js";

type Document = Record<string, any>;

export class CheckpointStore {
  constructor(
    private readonly workspace: RuntimeWorkspace,
    private readonly validator: ProtocolValidator,
  ) {}

  write(sessionId: string, checkpoint: Document, packageDocument: Document): void {
    this.validator.validateCheckpoint(checkpoint, packageDocument);
    writeTextAtomic(this.path(sessionId), `${canonicalJson(checkpoint)}\n`);
  }

  read(sessionId: string): Document {
    if (!existsSync(this.path(sessionId))) throw new Error(`checkpoint does not exist for session: ${sessionId}`);
    return parseJsonStrict(readFileSync(this.path(sessionId), "utf8")) as Document;
  }

  exists(sessionId: string): boolean {
    return existsSync(this.path(sessionId));
  }

  path(sessionId: string): string {
    return join(this.workspace.paths.sessions, storageKey(sessionId), "checkpoint.json");
  }
}
