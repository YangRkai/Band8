import type { IncomingMessage } from "node:http";

import { HttpError } from "./errors.js";

export const BODY_LIMITS = {
  timezone: 4_096,
  session: 16_384,
  textResponse: 65_536,
  trainingPackage: 1_048_576,
  coachContinuation: 1_048_576,
  coachExport: 16_384,
} as const;

export type JsonRequestObject = { [key: string]: unknown };

export async function readJsonBody(request: IncomingMessage, limit: number): Promise<JsonRequestObject> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new HttpError(415, "JSON_REQUIRED", "Mutation requests require application/json");
  const declaredLength = request.headers["content-length"];
  if (declaredLength !== undefined) {
    const declaredBytes = Number(declaredLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes < 0) throw new HttpError(400, "INVALID_CONTENT_LENGTH", "Content-Length must be a non-negative integer");
    if (declaredBytes > limit) throw new HttpError(413, "PAYLOAD_TOO_LARGE", `JSON payload exceeds ${limit} bytes`);
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > limit) {
      request.resume();
      throw new HttpError(413, "PAYLOAD_TOO_LARGE", `JSON payload exceeds ${limit} bytes`);
    }
    chunks.push(bytes);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON object required");
    return value as JsonRequestObject;
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body must be one valid JSON object");
  }
}
