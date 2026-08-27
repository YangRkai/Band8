import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";

import { HttpError } from "./errors.js";

export function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader("x-content-type-options", "nosniff");
  response.setHeader("referrer-policy", "no-referrer");
  response.setHeader("cross-origin-resource-policy", "same-origin");
  response.setHeader("cache-control", "no-store");
}

function equalToken(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function validateHost(request: IncomingMessage, expectedHost: string): void {
  if (request.headers.host !== expectedHost) throw new HttpError(403, "HOST_REJECTED", "Request Host is not this Band8 local server");
}

export function validateMutation(request: IncomingMessage, origin: string, token: string): void {
  if (request.headers.origin !== origin) throw new HttpError(403, "ORIGIN_REJECTED", "Mutation Origin is not this Band8 local server");
  const supplied = request.headers["x-band8-session"];
  if (typeof supplied !== "string" || !equalToken(supplied, token)) {
    throw new HttpError(403, "LOCAL_SESSION_REJECTED", "Local Band8 session token is missing or invalid");
  }
}
