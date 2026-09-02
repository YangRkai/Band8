import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalHash, canonicalJson, parseJsonStrict } from "../protocol/canonical.js";
import type { ProtocolValidator } from "../protocol/validator.js";
import { writeTextAtomic, readTextIfPresent } from "./atomic.js";
import type { RuntimeWorkspace } from "./workspace.js";
import { storageKey } from "./workspace.js";

type Document = Record<string, any>;

export interface ImportRecord {
  package_id: string;
  canonical_hash: string;
  imported_at: string;
  protocol_version: string;
  package_file: string;
  protected_file: string | null;
}

interface ImportRegistry {
  version: 1;
  packages: Record<string, ImportRecord>;
}

export class PackageImporter {
  readonly #registryPath: string;

  constructor(
    private readonly workspace: RuntimeWorkspace,
    private readonly validator: ProtocolValidator,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.#registryPath = join(workspace.paths.registry, "imports.json");
  }

  importFromText(packageText: string, protectedText?: string): { status: "IMPORTED" | "IDEMPOTENT"; packageId: string; canonicalHash: string } {
    const packageDocument = parseJsonStrict(packageText) as Document;
    const registry = this.#readRegistry();
    const seen = new Map(Object.values(registry.packages).map((record) => [record.package_id, record.canonical_hash]));
    const verdict = this.validator.validatePackage(packageDocument, seen);
    const packageId = packageDocument.package_id as string;
    const hash = canonicalHash(packageDocument);
    if (verdict.identity === "idempotent") {
      this.loadProtected(packageId);
      return { status: "IDEMPOTENT", packageId, canonicalHash: hash };
    }

    const reference = packageDocument.protected_evaluation_ref as Document | null;
    let protectedDocument: Document | undefined;
    if (reference !== null) {
      if (protectedText === undefined) throw new Error("protected evaluation is required");
      protectedDocument = parseJsonStrict(protectedText) as Document;
      this.validator.validateProtectedEvaluation(protectedDocument, packageDocument);
    } else if (protectedText !== undefined) {
      throw new Error("package does not declare protected evaluation");
    }

    const packageFile = join(this.workspace.paths.packages, `${storageKey(packageId)}.json`);
    this.#publishImmutable(packageFile, packageDocument);
    let protectedFile: string | null = null;
    if (protectedDocument !== undefined) {
      protectedFile = join(this.workspace.paths.protected, `${storageKey(protectedDocument.evaluation_id)}.json`);
      this.#publishImmutable(protectedFile, protectedDocument);
    }
    registry.packages[packageId] = {
      package_id: packageId,
      canonical_hash: hash,
      imported_at: this.now(),
      protocol_version: packageDocument.protocol_version,
      package_file: packageFile,
      protected_file: protectedFile,
    };
    writeTextAtomic(this.#registryPath, `${JSON.stringify(registry, null, 2)}\n`);
    return { status: "IMPORTED", packageId, canonicalHash: hash };
  }

  list(): ImportRecord[] {
    return Object.values(this.#readRegistry().packages).sort((left, right) => left.package_id.localeCompare(right.package_id));
  }

  loadPackage(packageId: string): Document {
    const record = this.#record(packageId);
    const expectedPath = join(this.workspace.paths.packages, `${storageKey(packageId)}.json`);
    if (record.package_id !== packageId || record.package_file !== expectedPath) {
      throw new Error("package registry integrity failure");
    }
    const document = parseJsonStrict(readFileSync(record.package_file, "utf8")) as Document;
    if (
      document.package_id !== packageId
      || document.protocol_version !== record.protocol_version
      || canonicalHash(document) !== record.canonical_hash
    ) {
      throw new Error("package integrity hash mismatch");
    }
    this.validator.validatePackage(document, new Map([[packageId, record.canonical_hash]]));
    return document;
  }

  loadProtected(packageId: string): Document | undefined {
    const record = this.#record(packageId);
    const packageDocument = this.loadPackage(packageId);
    const reference = packageDocument.protected_evaluation_ref as Document | null;
    if (reference === null) {
      if (record.protected_file !== null) throw new Error("protected evaluation registry integrity failure");
      return undefined;
    }
    const expectedPath = join(this.workspace.paths.protected, `${storageKey(reference.evaluation_id)}.json`);
    if (record.protected_file === null || record.protected_file !== expectedPath) {
      throw new Error("protected evaluation registry integrity failure");
    }
    const document = parseJsonStrict(readFileSync(record.protected_file, "utf8")) as Document;
    this.validator.validateProtectedEvaluation(document, packageDocument);
    return document;
  }

  record(packageId: string): ImportRecord {
    return this.#record(packageId);
  }

  #record(packageId: string): ImportRecord {
    const record = this.#readRegistry().packages[packageId];
    if (record === undefined) throw new Error(`package is not imported: ${packageId}`);
    return record;
  }

  #readRegistry(): ImportRegistry {
    const text = readTextIfPresent(this.#registryPath);
    return text === undefined ? { version: 1, packages: {} } : parseJsonStrict(text) as ImportRegistry;
  }

  #publishImmutable(path: string, document: Document): void {
    if (existsSync(path)) {
      const existing = parseJsonStrict(readFileSync(path, "utf8"));
      if (canonicalHash(existing) !== canonicalHash(document)) throw new Error("immutable package storage collision");
      return;
    }
    writeTextAtomic(path, `${canonicalJson(document)}\n`);
  }
}
