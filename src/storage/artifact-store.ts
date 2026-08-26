import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson, parseJsonStrict } from "../protocol/canonical.js";
import type { ProtocolValidator } from "../protocol/validator.js";
import { writeBytesAtomic, writeTextAtomic } from "./atomic.js";
import type { RuntimeWorkspace } from "./workspace.js";
import { storageKey } from "./workspace.js";

type Document = Record<string, any>;

export interface ArtifactContext {
  sessionId: string;
  runId: string;
  segmentId: string;
  packageId: string;
}

export interface ArtifactActivity {
  activityId: string;
  artifactType: "essay" | "rewrite" | "long_form_answer";
}

export interface ArtifactStorageRecord {
  version: 1;
  artifact_id: string;
  media_type: "text/plain; charset=utf-8";
  size_bytes: number;
  content_relative_path: string;
}

export interface ArtifactCommit {
  metadata: Document;
  storage: ArtifactStorageRecord;
}

export interface ArtifactReconciliation {
  status: "VALID" | "INVALID";
  valid_artifact_ids: string[];
  orphan_storage_keys: string[];
  unreferenced_artifact_ids: string[];
  invalid: Array<{ artifact_id: string | null; reason: string }>;
}

export class ArtifactStore {
  constructor(
    private readonly workspace: RuntimeWorkspace,
    private readonly validator: ProtocolValidator,
  ) {}

  get root(): string {
    return this.workspace.paths.artifacts;
  }

  commitText(
    context: ArtifactContext,
    activity: ArtifactActivity,
    artifactId: string,
    text: string,
    createdAt: string,
  ): ArtifactCommit {
    const bytes = Buffer.from(text, "utf8");
    const key = storageKey(artifactId);
    const contentRelativePath = `${key}/content.txt`;
    const contentPath = join(this.workspace.paths.artifacts, key, "content.txt");
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const metadata: Document = {
      schema_version: "0.1.0",
      protocol_version: "0.1.0",
      artifact_id: artifactId,
      session_id: context.sessionId,
      run_id: context.runId,
      segment_id: context.segmentId,
      package_id: context.packageId,
      artifact_type: activity.artifactType,
      created_at: createdAt,
      source_activity_id: activity.activityId,
      content_hash: contentHash,
      relative_path: contentRelativePath,
    };
    const storage: ArtifactStorageRecord = {
      version: 1,
      artifact_id: artifactId,
      media_type: "text/plain; charset=utf-8",
      size_bytes: bytes.byteLength,
      content_relative_path: contentRelativePath,
    };
    this.validator.validateArtifact(metadata);

    const existing = this.#readCommitIfPresent(artifactId);
    if (existing !== undefined) {
      const existingBytes = readFileSync(contentPath);
      if (
        canonicalJson(existing.metadata) !== canonicalJson(metadata)
        || canonicalJson(existing.storage) !== canonicalJson(storage)
        || !existingBytes.equals(bytes)
      ) {
        throw new Error(`artifact_id collision with different content: ${artifactId}`);
      }
      return existing;
    }

    writeBytesAtomic(contentPath, bytes);
    const durableBytes = readFileSync(contentPath);
    const durableHash = `sha256:${createHash("sha256").update(durableBytes).digest("hex")}`;
    if (durableHash !== contentHash) throw new Error("artifact content hash verification failed");
    writeTextAtomic(this.#storagePath(artifactId), `${canonicalJson(storage)}\n`);
    writeTextAtomic(this.#metadataPath(artifactId), `${canonicalJson(metadata)}\n`);
    return { metadata, storage };
  }

  loadMetadata(artifactId: string): Document {
    const path = this.#metadataPath(artifactId);
    if (!existsSync(path)) throw new Error(`artifact metadata does not exist: ${artifactId}`);
    const metadata = parseJsonStrict(readFileSync(path, "utf8")) as Document;
    this.validator.validateArtifact(metadata);
    this.#validateRuntimeIdentity(metadata, storageKey(artifactId));
    return metadata;
  }

  loadText(artifactId: string): string {
    const metadata = this.loadMetadata(artifactId);
    return readFileSync(join(this.workspace.paths.artifacts, metadata.relative_path), "utf8");
  }

  metadataPath(artifactId: string): string {
    return this.#metadataPath(artifactId);
  }

  contentPath(artifactId: string): string {
    const metadata = this.loadMetadata(artifactId);
    return join(this.workspace.paths.artifacts, metadata.relative_path);
  }

  listForSession(sessionId: string): Document[] {
    return [...this.#metadataById().values()]
      .filter((metadata) => metadata.session_id === sessionId)
      .sort((left, right) => String(left.artifact_id).localeCompare(String(right.artifact_id)));
  }

  metadataById(): ReadonlyMap<string, Document> {
    return this.#metadataById();
  }

  reconcile(sessionId: string, events: Document[]): ArtifactReconciliation {
    const eventArtifactIds = new Set<string>();
    for (const event of events.filter((item) => item.session_id === sessionId)) {
      if (["artifact_created", "writing_revision_created", "speaking_recording_created"].includes(event.event_type)) {
        eventArtifactIds.add(event.payload.artifact_id as string);
      }
      if (event.event_type === "answer_submitted" && event.payload.response_kind === "text" && event.payload.output_ref !== undefined) {
        eventArtifactIds.add(event.payload.output_ref as string);
      }
      if (["correction_submitted", "retry_completed"].includes(event.event_type) && event.payload.output_ref !== undefined) {
        eventArtifactIds.add(event.payload.output_ref as string);
      }
    }
    const valid: string[] = [];
    const orphanStorageKeys: string[] = [];
    const unreferenced: string[] = [];
    const invalid: Array<{ artifact_id: string | null; reason: string }> = [];
    const metadata = new Map<string, Document>();

    for (const key of this.#storageDirectories()) {
      const directory = join(this.workspace.paths.artifacts, key);
      const metadataPath = join(directory, "metadata.json");
      const contentPath = join(directory, "content.txt");
      if (!existsSync(metadataPath)) {
        if (existsSync(contentPath)) orphanStorageKeys.push(key);
        continue;
      }
      let document: Document;
      try {
        document = parseJsonStrict(readFileSync(metadataPath, "utf8")) as Document;
        this.validator.validateArtifact(document);
        this.#validateRuntimeIdentity(document, key);
      } catch {
        const referencedKey = [...eventArtifactIds].some((artifactId) => storageKey(artifactId) === key);
        if (referencedKey) invalid.push({ artifact_id: null, reason: "referenced artifact metadata is invalid" });
        continue;
      }
      metadata.set(document.artifact_id, document);
      if (document.session_id !== sessionId) continue;
      if (!existsSync(contentPath)) {
        invalid.push({ artifact_id: document.artifact_id, reason: "artifact metadata exists but bytes are missing" });
        continue;
      }
      const bytes = readFileSync(contentPath);
      const actualHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (actualHash !== document.content_hash) {
        invalid.push({ artifact_id: document.artifact_id, reason: "artifact content hash mismatch" });
        continue;
      }
      const storagePath = join(directory, "storage.json");
      if (!existsSync(storagePath)) {
        invalid.push({ artifact_id: document.artifact_id, reason: "artifact storage record is missing" });
        continue;
      }
      const storage = parseJsonStrict(readFileSync(storagePath, "utf8")) as ArtifactStorageRecord;
      if (
        storage.artifact_id !== document.artifact_id
        || storage.media_type !== "text/plain; charset=utf-8"
        || storage.size_bytes !== bytes.byteLength
        || storage.content_relative_path !== document.relative_path
      ) {
        invalid.push({ artifact_id: document.artifact_id, reason: "artifact storage record is inconsistent" });
        continue;
      }
      if (eventArtifactIds.has(document.artifact_id)) valid.push(document.artifact_id);
      else unreferenced.push(document.artifact_id);
    }
    for (const artifactId of eventArtifactIds) {
      if (!metadata.has(artifactId)) invalid.push({ artifact_id: artifactId, reason: "event references missing artifact metadata" });
    }
    return {
      status: invalid.length === 0 ? "VALID" : "INVALID",
      valid_artifact_ids: valid.sort(),
      orphan_storage_keys: orphanStorageKeys.sort(),
      unreferenced_artifact_ids: unreferenced.sort(),
      invalid,
    };
  }

  #readCommitIfPresent(artifactId: string): ArtifactCommit | undefined {
    if (!existsSync(this.#metadataPath(artifactId)) || !existsSync(this.#storagePath(artifactId))) return undefined;
    return {
      metadata: parseJsonStrict(readFileSync(this.#metadataPath(artifactId), "utf8")) as Document,
      storage: parseJsonStrict(readFileSync(this.#storagePath(artifactId), "utf8")) as ArtifactStorageRecord,
    };
  }

  #metadataById(): Map<string, Document> {
    const result = new Map<string, Document>();
    for (const key of this.#storageDirectories()) {
      const path = join(this.workspace.paths.artifacts, key, "metadata.json");
      if (!existsSync(path)) continue;
      try {
        const metadata = parseJsonStrict(readFileSync(path, "utf8")) as Document;
        this.validator.validateArtifact(metadata);
        this.#validateRuntimeIdentity(metadata, key);
        result.set(metadata.artifact_id, metadata);
      } catch {
        continue;
      }
    }
    return result;
  }

  #storageDirectories(): string[] {
    return readdirSync(this.workspace.paths.artifacts, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  #metadataPath(artifactId: string): string {
    return join(this.workspace.paths.artifacts, storageKey(artifactId), "metadata.json");
  }

  #storagePath(artifactId: string): string {
    return join(this.workspace.paths.artifacts, storageKey(artifactId), "storage.json");
  }

  #validateRuntimeIdentity(metadata: Document, key: string): void {
    if (key !== storageKey(metadata.artifact_id) || metadata.relative_path !== `${key}/content.txt`) {
      throw new Error("artifact storage identity is not Runtime-derived");
    }
  }
}
