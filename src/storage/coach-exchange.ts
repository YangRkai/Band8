import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { canonicalHash, canonicalJson, parseJsonStrict } from "../protocol/canonical.js";
import { writeTextAtomic } from "./atomic.js";
import type { ImportRecord } from "./package-importer.js";
import type { RuntimeWorkspace } from "./workspace.js";
import { storageKey } from "./workspace.js";

type Document = Record<string, any>;

export interface ContinuationBinding {
  checkpoint_id: string;
  prior_session_id: string;
  continuation_session_id: string;
  continuation_package_id: string;
  continuation_hash: string;
  prior_evidence_hash: string;
}

interface BindingRegistry {
  version: 1;
  checkpoints: Record<string, ContinuationBinding>;
}

function sha256File(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}

function relativeReference(fromDirectory: string, target: string): string {
  return relative(fromDirectory, target).replace(/\\/gu, "/");
}

export class CoachExchange {
  readonly #bindingsPath: string;

  constructor(private readonly workspace: RuntimeWorkspace) {
    this.#bindingsPath = join(workspace.paths.coach, "bindings.json");
  }

  export(
    checkpoint: Document,
    packageDocument: Document,
    packageRecord: ImportRecord,
    eventPath: string,
    artifacts: Array<{ metadata: Document; contentPath: string }>,
    relevantActivityRefs: string[],
  ): { manifestPath: string; bundlePath: string; bundle: Document } {
    const directory = this.outboxDirectory(checkpoint.checkpoint_id);
    const manifestPath = join(directory, "manifest.json");
    const bundlePath = join(directory, "bundle.json");
    const records: Document[] = [
      {
        record_id: packageDocument.package_id,
        record_kind: "training_package",
        producer: packageDocument.generator.producer,
        protocol_version: packageDocument.protocol_version,
        content_hash: canonicalHash(packageDocument),
        trust_classification: "data",
        relative_path: relativeReference(directory, packageRecord.package_file),
      },
      {
        record_id: `events-${checkpoint.session_id}`,
        record_kind: "raw_event_stream",
        producer: "Band8 Runtime",
        protocol_version: checkpoint.protocol_version,
        content_hash: sha256File(eventPath),
        trust_classification: "data",
        relative_path: relativeReference(directory, eventPath),
      },
      ...artifacts.map(({ metadata, contentPath }) => ({
        record_id: metadata.artifact_id,
        record_kind: "learner_artifact",
        producer: "learner",
        protocol_version: metadata.protocol_version,
        content_hash: metadata.content_hash,
        trust_classification: "data",
        relative_path: relativeReference(directory, contentPath),
      })),
    ];
    const bundle: Document = {
      schema_version: "0.1.0",
      protocol_version: "0.1.0",
      bundle_type: "band8_coach_input",
      trust_classification: "DATA_ONLY",
      trust_contract: "COACH_INPUT_TRUST 0.1",
      checkpoint_id: checkpoint.checkpoint_id,
      manifest_ref: "manifest.json",
      relevant_activity_refs: [...relevantActivityRefs],
      contract_versions: packageDocument.contract_versions,
      records,
    };
    writeTextAtomic(manifestPath, `${canonicalJson(checkpoint)}\n`);
    writeTextAtomic(bundlePath, `${canonicalJson(bundle)}\n`);
    return { manifestPath, bundlePath, bundle };
  }

  bind(binding: ContinuationBinding): "ATTACHED" | "IDEMPOTENT" {
    const registry = this.#readBindings();
    const existing = registry.checkpoints[binding.checkpoint_id];
    if (existing !== undefined) {
      if (existing.prior_evidence_hash !== binding.prior_evidence_hash) throw new Error("prior evidence changed after continuation binding");
      if (existing.continuation_package_id === binding.continuation_package_id) {
        if (existing.continuation_hash !== binding.continuation_hash) throw new Error("package_id collision with different canonical content");
        return "IDEMPOTENT";
      }
      throw new Error(`checkpoint is already bound to continuation package: ${binding.checkpoint_id}`);
    }
    registry.checkpoints[binding.checkpoint_id] = binding;
    writeTextAtomic(this.#bindingsPath, `${canonicalJson(registry)}\n`);
    return "ATTACHED";
  }

  binding(checkpointId: string): ContinuationBinding | undefined {
    return this.#readBindings().checkpoints[checkpointId];
  }

  outboxDirectory(checkpointId: string): string {
    return join(this.workspace.paths.coach, "outbox", storageKey(checkpointId));
  }

  #readBindings(): BindingRegistry {
    if (!existsSync(this.#bindingsPath)) return { version: 1, checkpoints: {} };
    return parseJsonStrict(readFileSync(this.#bindingsPath, "utf8")) as BindingRegistry;
  }
}
