import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, relative, resolve } from "node:path";

import { Band8Runtime, type RuntimeOptions } from "../runtime/runtime.js";
import {
  PRODUCT_API_GET_ROUTES,
  PRODUCT_API_MUTATION_ROUTES,
  type ActivityResponseDto,
  type ProductApiGetMap,
  type ProductApiMutationMap,
} from "../product-api/dto.js";
import { BODY_LIMITS, readJsonBody, type JsonRequestObject } from "./body.js";
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

function requireObject(value: unknown, name: string): JsonRequestObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_INPUT", `${name} must be a JSON object`);
  return value as JsonRequestObject;
}

type ProductGetRoute = keyof ProductApiGetMap;
type ProductMutationRoute = keyof ProductApiMutationMap;

export type ProductGetHandlers = {
  [Path in ProductGetRoute]: (url: URL) => ProductApiGetMap[Path];
};

interface ProductMutationHandler<Path extends ProductMutationRoute> {
  limit: number;
  parse: (body: JsonRequestObject) => ProductApiMutationMap[Path]["request"];
  execute: (input: ProductApiMutationMap[Path]["request"]) => ProductApiMutationMap[Path]["response"];
  headers?: (output: ProductApiMutationMap[Path]["response"]) => Readonly<Record<string, string>>;
}

export type ProductMutationHandlers = {
  [Path in ProductMutationRoute]: ProductMutationHandler<Path>;
};

function optionalString(body: JsonRequestObject, field: string): string | undefined {
  const value = body[field];
  if (value !== undefined && typeof value !== "string") throw new HttpError(400, "INVALID_INPUT", `${field} must be a string`);
  return value as string | undefined;
}

function paginationInteger(value: string | null, name: "limit" | "cursor"): number | undefined {
  if (value === null) return undefined;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) throw new HttpError(400, "INVALID_PAGINATION", `${name} must be a non-negative integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (name === "limit" && (parsed < 1 || parsed > 100))) {
    throw new HttpError(400, "INVALID_PAGINATION", name === "limit" ? "limit must be from 1 to 100" : "cursor is outside the supported range");
  }
  return parsed;
}

export function createProductApiHandlers(runtime: Band8Runtime): {
  get: ProductGetHandlers;
  mutation: ProductMutationHandlers;
} {
  const get = {
    "/api/v1/today": () => runtime.today(),
    "/api/v1/training": () => runtime.training(),
    "/api/v1/progress": () => runtime.progress(),
    "/api/v1/history": (url) => {
      const limit = paginationInteger(url.searchParams.get("limit"), "limit");
      const cursor = paginationInteger(url.searchParams.get("cursor"), "cursor");
      return runtime.history({
        ...(limit === undefined ? {} : { limit }),
        ...(cursor === undefined ? {} : { cursor }),
      });
    },
    "/api/v1/coach": () => runtime.coachStatus(),
    "/api/v1/settings": () => runtime.workspaceInformation(),
  } satisfies ProductGetHandlers;

  const mutation = {
    "/api/v1/timezone": {
      limit: BODY_LIMITS.timezone,
      parse: (body) => {
        if (body.operation !== "configure" && body.operation !== "change") {
          throw new HttpError(400, "INVALID_TIMEZONE_OPERATION", "operation must be configure or change");
        }
        if (typeof body.timeZone !== "string") throw new HttpError(400, "INVALID_TIMEZONE_INPUT", "timeZone must be a string");
        return { operation: body.operation, timeZone: body.timeZone };
      },
      execute: (input) => input.operation === "configure"
        ? runtime.configureLearningTimezone(input.timeZone)
        : runtime.changeLearningTimezone(input.timeZone),
    },
    "/api/v1/packages/import": {
      limit: BODY_LIMITS.trainingPackage,
      parse: (body) => ({
        package: requireObject(body.package, "package"),
        ...(body.protectedEvaluation === undefined || body.protectedEvaluation === null
          ? {}
          : { protectedEvaluation: requireObject(body.protectedEvaluation, "protectedEvaluation") }),
      }),
      execute: (input) => runtime.importPackage(
        JSON.stringify(input.package),
        input.protectedEvaluation === undefined ? undefined : JSON.stringify(input.protectedEvaluation),
      ),
    },
    "/api/v1/sessions/start": {
      limit: BODY_LIMITS.session,
      parse: (body) => {
        const packageId = optionalString(body, "packageId");
        const sessionId = optionalString(body, "sessionId");
        return {
          ...(packageId === undefined ? {} : { packageId }),
          ...(sessionId === undefined ? {} : { sessionId }),
        };
      },
      execute: (input) => runtime.beginTraining(input.packageId, input.sessionId),
    },
    "/api/v1/training/complete": {
      limit: BODY_LIMITS.textResponse,
      parse: (body) => {
        if (typeof body.sessionId !== "string") throw new HttpError(400, "INVALID_INPUT", "sessionId must be a string");
        if (body.response === undefined) return { sessionId: body.sessionId };
        const responseObject = requireObject(body.response, "response");
        const hasOptions = responseObject.optionIds !== undefined;
        const hasText = responseObject.text !== undefined;
        if (hasOptions === hasText) throw new HttpError(400, "INVALID_INPUT", "response must contain exactly one of optionIds or text");
        let activityResponse: ActivityResponseDto;
        if (hasOptions) {
          if (!Array.isArray(responseObject.optionIds) || responseObject.optionIds.some((item) => typeof item !== "string")) {
            throw new HttpError(400, "INVALID_INPUT", "optionIds must be a string array");
          }
          activityResponse = { optionIds: [...responseObject.optionIds] as string[] };
        } else {
          if (typeof responseObject.text !== "string") throw new HttpError(400, "INVALID_INPUT", "text must be a string");
          activityResponse = { text: responseObject.text };
        }
        return { sessionId: body.sessionId, response: activityResponse };
      },
      execute: (input) => runtime.submitCurrentActivity(input.sessionId, input.response),
    },
    "/api/v1/coach/export": {
      limit: BODY_LIMITS.coachExport,
      parse: (body) => {
        if (typeof body.sessionId !== "string") throw new HttpError(400, "INVALID_INPUT", "sessionId must be a string");
        return { sessionId: body.sessionId };
      },
      execute: (input) => runtime.exportCheckpointDownload(input.sessionId),
      headers: (output) => ({ "content-disposition": `attachment; filename="band8-coach-${output.checkpoint_id}.json"` }),
    },
    "/api/v1/coach/import": {
      limit: BODY_LIMITS.coachContinuation,
      parse: (body) => {
        if (typeof body.priorSessionId !== "string") throw new HttpError(400, "INVALID_INPUT", "priorSessionId must be a string");
        return { priorSessionId: body.priorSessionId, package: requireObject(body.package, "package") };
      },
      execute: (input) => ({
        ...runtime.attachContinuation(input.priorSessionId, JSON.stringify(input.package)),
        coach: runtime.coachStatus(),
      }),
    },
  } satisfies ProductMutationHandlers;
  return { get, mutation };
}

function isRoute<Route extends string>(routes: readonly Route[], value: string): value is Route {
  return routes.some((route) => route === value);
}

function sendProductGet<Path extends ProductGetRoute>(
  response: ServerResponse,
  handler: ProductGetHandlers[Path],
  url: URL,
): void {
  const output: ProductApiGetMap[Path] = handler(url);
  sendJson(response, 200, output);
}

async function sendProductMutation<Path extends ProductMutationRoute>(
  request: IncomingMessage,
  response: ServerResponse,
  handlers: ProductMutationHandlers,
  path: Path,
): Promise<void> {
  const handler: ProductMutationHandler<Path> = handlers[path];
  const input = handler.parse(await readJsonBody(request, handler.limit));
  const output = handler.execute(input);
  for (const [name, value] of Object.entries(handler.headers?.(output) ?? {})) response.setHeader(name, value);
  sendJson(response, 200, output);
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
  runtime.recoverCrashState();
  const staticRoot = resolve(options.staticRoot ?? join(options.repositoryRoot, "dist", "web"));
  const productApi = createProductApiHandlers(runtime);
  let expectedHost = "";
  let origin = "";
  const httpServer = createServer(async (request, response) => {
    applySecurityHeaders(response);
    try {
      validateHost(request, expectedHost);
      const requestUrl = new URL(request.url ?? "/", origin);
      if (request.method === "POST") validateMutation(request, origin, token);
      if (request.method === "GET" && isRoute(PRODUCT_API_GET_ROUTES, requestUrl.pathname)) {
        sendProductGet(response, productApi.get[requestUrl.pathname], requestUrl);
        return;
      }
      if (request.method === "POST" && isRoute(PRODUCT_API_MUTATION_ROUTES, requestUrl.pathname)) {
        await sendProductMutation(request, response, productApi.mutation, requestUrl.pathname);
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
