import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { extname, join, relative, resolve } from "node:path";

import { Band8Runtime, type RuntimeOptions } from "../runtime/runtime.js";
import { BODY_LIMITS, readJsonBody } from "./body.js";
import { HttpError, safeError } from "./errors.js";
import { applySecurityHeaders, validateHost, validateMutation } from "./security.js";

export interface StartBand8ServerOptions {
  repositoryRoot: string;
  workspacePath: string;
  port?: number;
  staticRoot?: string;
  runtimeOptions?: Omit<RuntimeOptions, "repositoryRoot" | "workspacePath">;
}

export interface RunningBand8Server {
  host: "127.0.0.1";
  port: number;
  url: string;
  close: () => Promise<void>;
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const bytes = Buffer.from(JSON.stringify(value), "utf8");
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("content-length", bytes.length);
  response.end(bytes);
}

function requireObject(value: unknown, name: string): Record<string, any> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_INPUT", `${name} must be a JSON object`);
  return value as Record<string, any>;
}

function entryHtml(staticRoot: string, token: string): string {
  const path = join(staticRoot, "index.html");
  const source = existsSync(path)
    ? readFileSync(path, "utf8")
    : "<!doctype html><html lang=\"en\"><head><meta charset=\"UTF-8\"></head><body><div id=\"root\"></div></body></html>";
  const meta = `<meta name="band8-session" content="${token}">`;
  return source.includes("</head>") ? source.replace("</head>", `${meta}</head>`) : `${meta}${source}`;
}

function staticAssetPath(staticRoot: string, pathname: string): string | undefined {
  if (!pathname.startsWith("/assets/")) return undefined;
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); } catch { return undefined; }
  const segments = decoded.split("/").filter(Boolean);
  if (segments[0] !== "assets" || segments.length !== 2 || segments.some((segment) => segment === "." || segment === "..")) return undefined;
  const path = resolve(staticRoot, "assets", segments[1]!);
  const inside = relative(resolve(staticRoot, "assets"), path);
  return inside.length > 0 && !inside.startsWith("..") && !inside.includes("/") && !inside.includes("\\") ? path : undefined;
}

function assetContentType(path: string): string {
  const types: Record<string, string> = {
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
  };
  return types[extname(path).toLowerCase()] ?? "application/octet-stream";
}

export async function startBand8Server(options: StartBand8ServerOptions): Promise<RunningBand8Server> {
  const host = "127.0.0.1" as const;
  const token = randomBytes(32).toString("base64url");
  const runtime = Band8Runtime.open({
    ...options.runtimeOptions,
    repositoryRoot: resolve(options.repositoryRoot),
    workspacePath: resolve(options.workspacePath),
  });
  const staticRoot = resolve(options.staticRoot ?? join(options.repositoryRoot, "dist", "web"));
  let expectedHost = "";
  let origin = "";
  const httpServer = createServer(async (request, response) => {
    applySecurityHeaders(response);
    try {
      validateHost(request, expectedHost);
      const requestUrl = new URL(request.url ?? "/", origin);
      if (request.method === "POST") validateMutation(request, origin, token);
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/today") {
        sendJson(response, 200, runtime.today());
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/training") {
        sendJson(response, 200, runtime.training());
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/progress") {
        sendJson(response, 200, runtime.progress());
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/coach") {
        sendJson(response, 200, runtime.coachStatus());
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/settings") {
        sendJson(response, 200, runtime.workspaceInformation());
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/v1/history") {
        const limit = requestUrl.searchParams.get("limit");
        const cursor = requestUrl.searchParams.get("cursor");
        sendJson(response, 200, runtime.history({
          ...(limit === null ? {} : { limit: Number(limit) }),
          ...(cursor === null ? {} : { cursor: Number(cursor) }),
        }));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/timezone") {
        const body = await readJsonBody(request, BODY_LIMITS.timezone);
        if (typeof body.timeZone !== "string") throw new HttpError(400, "INVALID_TIMEZONE_INPUT", "timeZone must be a string");
        const epoch = body.operation === "configure"
          ? runtime.configureLearningTimezone(body.timeZone)
          : body.operation === "change"
            ? runtime.changeLearningTimezone(body.timeZone)
            : (() => { throw new HttpError(400, "INVALID_TIMEZONE_OPERATION", "operation must be configure or change"); })();
        sendJson(response, 200, epoch);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/packages/import") {
        const body = await readJsonBody(request, BODY_LIMITS.trainingPackage);
        const packageDocument = requireObject(body.package, "package");
        const protectedDocument = body.protectedEvaluation === undefined || body.protectedEvaluation === null
          ? undefined
          : requireObject(body.protectedEvaluation, "protectedEvaluation");
        const imported = runtime.importPackage(
          JSON.stringify(packageDocument),
          protectedDocument === undefined ? undefined : JSON.stringify(protectedDocument),
        );
        sendJson(response, 200, imported);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/sessions/start") {
        const body = await readJsonBody(request, BODY_LIMITS.session);
        if (body.packageId !== undefined && typeof body.packageId !== "string") throw new HttpError(400, "INVALID_INPUT", "packageId must be a string");
        if (body.sessionId !== undefined && typeof body.sessionId !== "string") throw new HttpError(400, "INVALID_INPUT", "sessionId must be a string");
        sendJson(response, 200, runtime.beginTraining(body.packageId as string | undefined, body.sessionId as string | undefined));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/training/complete") {
        const body = await readJsonBody(request, BODY_LIMITS.textResponse);
        if (typeof body.sessionId !== "string") throw new HttpError(400, "INVALID_INPUT", "sessionId must be a string");
        const activityResponse = body.response === undefined ? undefined : requireObject(body.response, "response");
        sendJson(response, 200, runtime.submitCurrentActivity(body.sessionId, activityResponse));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/coach/export") {
        const body = await readJsonBody(request, BODY_LIMITS.coachExport);
        if (typeof body.sessionId !== "string") throw new HttpError(400, "INVALID_INPUT", "sessionId must be a string");
        const exported = runtime.exportCheckpointDownload(body.sessionId);
        response.setHeader("content-disposition", `attachment; filename="band8-coach-${exported.checkpoint_id}.json"`);
        sendJson(response, 200, exported);
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/v1/coach/import") {
        const body = await readJsonBody(request, BODY_LIMITS.coachContinuation);
        if (typeof body.priorSessionId !== "string") throw new HttpError(400, "INVALID_INPUT", "priorSessionId must be a string");
        const packageDocument = requireObject(body.package, "package");
        const attached = runtime.attachContinuation(body.priorSessionId, JSON.stringify(packageDocument));
        sendJson(response, 200, { ...attached, coach: runtime.coachStatus() });
        return;
      }
      if (requestUrl.pathname.startsWith("/api/")) throw new HttpError(404, "API_NOT_FOUND", "API route not found");
      if (request.method !== "GET" && request.method !== "HEAD") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method not allowed");
      const assetPath = staticAssetPath(staticRoot, requestUrl.pathname);
      if (requestUrl.pathname.startsWith("/assets/")) {
        if (assetPath === undefined || !existsSync(assetPath)) throw new HttpError(404, "ASSET_NOT_FOUND", "Static asset not found");
        const bytes = readFileSync(assetPath);
        response.statusCode = 200;
        response.setHeader("content-type", assetContentType(assetPath));
        response.setHeader("cache-control", "public, max-age=31536000, immutable");
        response.setHeader("content-length", bytes.length);
        response.end(request.method === "HEAD" ? undefined : bytes);
        return;
      }
      const html = entryHtml(staticRoot, token);
      response.statusCode = 200;
      response.setHeader("content-type", "text/html; charset=utf-8");
      response.end(request.method === "HEAD" ? undefined : html);
    } catch (error) {
      const safe = safeError(error);
      sendJson(response, safe.status, safe.body);
    }
  });

  await new Promise<void>((resolveListen, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(options.port ?? 0, host, () => resolveListen());
  });
  const address = httpServer.address();
  if (address === null || typeof address === "string") throw new Error("Band8 server did not receive a TCP address");
  expectedHost = `${host}:${address.port}`;
  origin = `http://${expectedHost}`;
  let closed = false;
  return {
    host,
    port: address.port,
    url: origin,
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolveClose, reject) => httpServer.close((error) => error === undefined ? resolveClose() : reject(error)));
    },
  };
}
