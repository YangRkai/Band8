import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { startBand8Server, type RunningBand8Server } from "../../src/server/server.js";
import { BODY_LIMITS, readJsonBody } from "../../src/server/body.js";

const repositoryRoot = resolve(process.cwd());
const workspaces: string[] = [];
const servers: RunningBand8Server[] = [];

function workspace(): string {
  const temporaryRoot = join(repositoryRoot, ".tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  const path = mkdtempSync(join(temporaryRoot, "band8-local-server-"));
  workspaces.push(path);
  return path;
}

async function server(path = workspace()): Promise<RunningBand8Server> {
  const running = await startBand8Server({
    repositoryRoot,
    workspacePath: path,
    port: 0,
    staticRoot: resolve(repositoryRoot, "tests/server/fixtures/web"),
  });
  servers.push(running);
  return running;
}

function tokenFrom(html: string): string {
  const match = html.match(/<meta name="band8-session" content="([^"]+)">/u);
  if (match?.[1] === undefined) throw new Error("entry HTML has no Band8 session token");
  return match[1];
}

async function rawPost(url: string, headers: Record<string, string>, body: string): Promise<number> {
  return await new Promise<number>((resolveStatus, reject) => {
    const request = httpRequest(url, { method: "POST", headers }, (response) => {
      response.resume();
      response.once("end", () => resolveStatus(response.statusCode ?? 0));
    });
    request.once("error", reject);
    request.end(body);
  });
}

async function rawPostResponse(url: string, headers: Record<string, string>, chunks: string[]): Promise<{ status: number; body: string }> {
  return await new Promise((resolveResponse, reject) => {
    const request = httpRequest(url, { method: "POST", headers }, (response) => {
      const responseChunks: Buffer[] = [];
      response.on("data", (chunk) => responseChunks.push(Buffer.from(chunk)));
      response.once("end", () => resolveResponse({
        status: response.statusCode ?? 0,
        body: Buffer.concat(responseChunks).toString("utf8"),
      }));
    });
    request.once("error", reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

afterEach(async () => {
  for (const running of servers.splice(0)) await running.close();
  for (const path of workspaces.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("Band8 loopback server security", () => {
  it("binds an automatically selected loopback port and serves a hardened same-origin entry", async () => {
    const running = await server();
    const response = await fetch(running.url);
    const html = await response.text();

    expect(running.host).toBe("127.0.0.1");
    expect(running.port).toBeGreaterThan(0);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(tokenFrom(html)).toMatch(/^[A-Za-z0-9_-]{32,}$/u);
  });

  it("serves only built static assets from the fixed web root", async () => {
    const running = await server();
    const html = await (await fetch(running.url)).text();
    const token = tokenFrom(html);
    const assetPath = html.match(/<script[^>]+src="([^"]+\.js)"/u)?.[1];
    if (assetPath === undefined) throw new Error("built entry has no JavaScript asset");
    const asset = await fetch(`${running.url}${assetPath}`);
    const source = await asset.text();

    expect(asset.status).toBe(200);
    expect(asset.headers.get("content-type")).toContain("text/javascript");
    expect(source).not.toContain(token);
    expect((await fetch(`${running.url}/assets/..%2F..%2Fpackage.json`)).status).toBe(404);
  });

  it("requires exact Origin, Host, startup token, and JSON for every mutation", async () => {
    const running = await server();
    const token = tokenFrom(await (await fetch(running.url)).text());
    const body = JSON.stringify({ operation: "configure", timeZone: "Asia/Shanghai" });
    const post = (headers: Record<string, string>) => fetch(`${running.url}/api/v1/timezone`, {
      method: "POST",
      headers,
      body,
    });

    expect((await post({ "content-type": "application/json", "x-band8-session": token })).status).toBe(403);
    expect((await post({ origin: "https://evil.example", "content-type": "application/json", "x-band8-session": token })).status).toBe(403);
    expect((await post({ origin: running.url, "content-type": "application/json", "x-band8-session": "wrong-token" })).status).toBe(403);
    expect((await post({ origin: running.url, "content-type": "text/plain", "x-band8-session": token })).status).toBe(415);

    const accepted = await post({ origin: running.url, "content-type": "application/json", "x-band8-session": token });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ learning_timezone: "Asia/Shanghai" });
    expect(accepted.headers.get("access-control-allow-origin")).toBeNull();

    const wrongHostStatus = await rawPost(`${running.url}/api/v1/timezone`, {
        host: "localhost:65535",
        origin: running.url,
        "content-type": "application/json",
        "x-band8-session": token,
      }, body);
    expect(wrongHostStatus).toBe(403);
  });

  it("returns bounded stable errors without stack traces, paths, or exception objects", async () => {
    const running = await server();
    const token = tokenFrom(await (await fetch(running.url)).text());
    const oversized = JSON.stringify({ value: "x".repeat(1_100_000) });
    const response = await fetch(`${running.url}/api/v1/timezone`, {
      method: "POST",
      headers: {
        origin: running.url,
        "content-type": "application/json",
        "x-band8-session": token,
      },
      body: oversized,
    });
    const serialized = JSON.stringify(await response.json());

    expect(response.status).toBe(413);
    expect(serialized).toContain("PAYLOAD_TOO_LARGE");
    expect(serialized).not.toMatch(/stack|E:\\\\Band8|exception/iu);
    const invalidTimezone = await fetch(`${running.url}/api/v1/timezone`, {
      method: "POST",
      headers: { origin: running.url, "content-type": "application/json", "x-band8-session": token },
      body: JSON.stringify({ operation: "change", timeZone: "Not/A_Timezone" }),
    });
    expect(await invalidTimezone.json()).toEqual({
      code: "LEARNING_TIMEZONE_REJECTED",
      message: "The learning timezone is not a supported IANA timezone.",
    });
    expect((await fetch(`${running.url}/api/v1/fetch?url=https://example.com`)).status).toBe(404);
    expect((await fetch(`${running.url}/api/v1/files?path=C:%5CWindows`)).status).toBe(404);
    expect((await fetch(`${running.url}/api/v1/shell`)).status).toBe(404);
  });

  it("freezes explicit route body limits to the transport and protocol contracts", () => {
    expect(BODY_LIMITS).toEqual({
      timezone: 4_096,
      session: 16_384,
      textResponse: 65_536,
      trainingPackage: 1_048_576,
      coachContinuation: 1_048_576,
      coachExport: 16_384,
    });
  });

  it("rejects declared payloads above every route class limit before buffering the body", async () => {
    const running = await server();
    const token = tokenFrom(await (await fetch(running.url)).text());
    const headersFor = (limit: number) => ({
      origin: running.url,
      "content-type": "application/json",
      "content-length": String(limit + 1),
      "x-band8-session": token,
    });
    const cases = [
      ["/api/v1/timezone", BODY_LIMITS.timezone],
      ["/api/v1/sessions/start", BODY_LIMITS.session],
      ["/api/v1/training/complete", BODY_LIMITS.textResponse],
      ["/api/v1/packages/import", BODY_LIMITS.trainingPackage],
      ["/api/v1/coach/import", BODY_LIMITS.coachContinuation],
      ["/api/v1/coach/export", BODY_LIMITS.coachExport],
    ] as const;

    for (const [route, limit] of cases) {
      const response = await rawPostResponse(`${running.url}${route}`, headersFor(limit), ["x".repeat(limit + 1)]);
      expect(response.status, route).toBe(413);
      expect(JSON.parse(response.body), route).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    }
  }, 15_000);

  it("rejects malformed Content-Length before parsing JSON", async () => {
    const request = Readable.from(["{}"]) as unknown as Parameters<typeof readJsonBody>[0];
    Object.defineProperty(request, "headers", {
      value: { "content-type": "application/json", "content-length": "1.5" },
    });

    await expect(readJsonBody(request, BODY_LIMITS.timezone)).rejects.toMatchObject({
      status: 400,
      code: "INVALID_CONTENT_LENGTH",
    });
  });

  it("stops and returns a stable 413 when a chunked request crosses its route limit", async () => {
    const running = await server();
    const token = tokenFrom(await (await fetch(running.url)).text());
    const response = await rawPostResponse(`${running.url}/api/v1/timezone`, {
      origin: running.url,
      "content-type": "application/json",
      "x-band8-session": token,
    }, ["{\"value\":\"", "x".repeat(BODY_LIMITS.timezone), "\"}"]);

    expect(response.status).toBe(413);
    expect(JSON.parse(response.body)).toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects malformed or out-of-range History pagination instead of coercing it", async () => {
    const running = await server();
    for (const query of ["limit=0", "limit=101", "limit=1.5", "limit=NaN", "cursor=-1", "cursor=1.5"]) {
      const response = await fetch(`${running.url}/api/v1/history?${query}`);
      expect(response.status, query).toBe(400);
      expect(await response.json(), query).toMatchObject({ code: "INVALID_PAGINATION" });
    }
  });

  it("invalidates the startup token after a complete server restart", async () => {
    const path = workspace();
    const first = await server(path);
    const firstToken = tokenFrom(await (await fetch(first.url)).text());
    await first.close();
    servers.splice(servers.indexOf(first), 1);
    const second = await server(path);
    const secondToken = tokenFrom(await (await fetch(second.url)).text());

    expect(secondToken).not.toBe(firstToken);
    const response = await fetch(`${second.url}/api/v1/timezone`, {
      method: "POST",
      headers: {
        origin: second.url,
        "content-type": "application/json",
        "x-band8-session": firstToken,
      },
      body: JSON.stringify({ operation: "configure", timeZone: "Asia/Shanghai" }),
    });
    expect(response.status).toBe(403);
  });
});
