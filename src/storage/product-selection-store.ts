import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { canonicalJson, parseJsonStrict } from "../protocol/canonical.js";
import { writeTextAtomic } from "./atomic.js";
import type { RuntimeWorkspace } from "./workspace.js";

export interface ProductSelection {
  version: 1;
  active_package_id: string | null;
  active_session_id: string | null;
  active_run_id: string | null;
  updated_at: string;
}

function validate(selection: ProductSelection): void {
  const nonEmptyOrNull = (value: string | null): boolean => value === null || value.length > 0;
  if (
    selection.version !== 1
    || Object.keys(selection).some((key) => !["version", "active_package_id", "active_session_id", "active_run_id", "updated_at"].includes(key))
    || !nonEmptyOrNull(selection.active_package_id)
    || !nonEmptyOrNull(selection.active_session_id)
    || !nonEmptyOrNull(selection.active_run_id)
    || !Number.isFinite(Date.parse(selection.updated_at))
    || (selection.active_package_id !== null && selection.active_session_id !== null)
    || (selection.active_package_id === null && selection.active_session_id === null && selection.active_run_id !== null)
  ) throw new Error("invalid product selection");
}

export class ProductSelectionStore {
  readonly #path: string;

  constructor(private readonly workspace: RuntimeWorkspace) {
    this.#path = join(workspace.paths.settings, "product-selection.json");
  }

  read(): ProductSelection | undefined {
    if (!existsSync(this.#path)) return undefined;
    const value = parseJsonStrict(readFileSync(this.#path, "utf8")) as ProductSelection;
    validate(value);
    return value;
  }

  selectPackage(packageId: string, runId: string, updatedAt: string): ProductSelection {
    return this.#write({ version: 1, active_package_id: packageId, active_session_id: null, active_run_id: runId, updated_at: updatedAt });
  }

  selectSession(sessionId: string, runId: string, updatedAt: string): ProductSelection {
    return this.#write({ version: 1, active_package_id: null, active_session_id: sessionId, active_run_id: runId, updated_at: updatedAt });
  }

  clear(updatedAt: string): ProductSelection {
    return this.#write({ version: 1, active_package_id: null, active_session_id: null, active_run_id: null, updated_at: updatedAt });
  }

  #write(selection: ProductSelection): ProductSelection {
    validate(selection);
    writeTextAtomic(this.#path, `${canonicalJson(selection)}\n`);
    return selection;
  }
}
