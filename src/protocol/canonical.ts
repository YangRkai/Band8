import { createHash } from "node:crypto";

import canonicalize from "canonicalize";
import {
  getNodeValue,
  parseTree,
  type Node as JsonNode,
  type ParseError,
} from "jsonc-parser";

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

function assertUnicode(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalizationError("lone high surrogate is forbidden by RFC 8785");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalizationError("lone low surrogate is forbidden by RFC 8785");
    }
  }
}

function assertJcsValue(value: unknown): void {
  if (value === null || typeof value === "boolean") return;
  if (typeof value === "string") {
    assertUnicode(value);
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalizationError("non-finite number is forbidden");
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throw new CanonicalizationError("integer is outside the JavaScript safe integer range");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJcsValue(item);
    return;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      assertUnicode(key);
      assertJcsValue(child);
    }
    return;
  }
  throw new CanonicalizationError(`unsupported JSON value type: ${typeof value}`);
}

function validateSyntaxTree(node: JsonNode): void {
  if (node.type === "object") {
    const names = new Set<string>();
    for (const property of node.children ?? []) {
      const [nameNode, valueNode] = property.children ?? [];
      const name = nameNode?.value;
      if (typeof name !== "string" || valueNode === undefined) {
        throw new CanonicalizationError("malformed JSON object property");
      }
      if (names.has(name)) {
        throw new CanonicalizationError(`duplicate JSON object property: ${name}`);
      }
      names.add(name);
      validateSyntaxTree(valueNode);
    }
  } else if (node.type === "array") {
    for (const child of node.children ?? []) validateSyntaxTree(child);
  }
}

export function parseJsonStrict(text: string): unknown {
  const errors: ParseError[] = [];
  const tree = parseTree(text, errors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: true,
  });
  if (tree === undefined || errors.length > 0) {
    throw new CanonicalizationError("malformed JSON input");
  }
  validateSyntaxTree(tree);
  const value = getNodeValue(tree) as unknown;
  assertJcsValue(value);
  return value;
}

export function canonicalJson(value: unknown): string {
  assertJcsValue(value);
  const serialize = canonicalize as unknown as (input: unknown) => string | undefined;
  const result = serialize(value);
  if (result === undefined) throw new CanonicalizationError("value is not RFC 8785 serializable");
  return result;
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value));
}

export function canonicalHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalBytes(value)).digest("hex")}`;
}
