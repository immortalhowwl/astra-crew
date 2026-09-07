import { createServer, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_RPC_URL, ROBINHOOD_CHAIN_ID, fetchLiveSnapshot, type LiveSnapshot, type RpcCaller } from "./live.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_ASSETS = resolve(projectRoot, "assets/desk");
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cross-origin-opener-policy": "same-origin",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY"
} as const;

export interface DeskServerOptions {
  rpc?: RpcCaller;
  rpcUrl?: string;
  assetsRoot?: string;
  cacheMs?: number;
  failureCacheMs?: number;
}

export interface RpcCallerOptions {
  fetch?: typeof fetch;
  retryDelayMs?: number;
}

export function createHttpRpcCaller(url?: string, options: RpcCallerOptions = {}): RpcCaller {
  let requestId = 0;
  let lastRequestAt = 0;
  let lastLogsAt = 0;
  const fetcher = options.fetch ?? fetch;
  const retryDelayMs = options.retryDelayMs ?? 400;
  const endpoints = (url ? url.split(",").map((value) => value.trim()).filter(Boolean) : [
    "https://robinhood-rpc.publicnode.com#nologs",
    DEFAULT_RPC_URL
  ]).map((value) => ({ url: value.replace(/#nologs$/, ""), logs: !value.endsWith("#nologs") }));
  const sleep = (milliseconds: number): Promise<void> => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
  return async (method, params = []) => {
    const candidates = endpoints.filter((endpoint) => method !== "eth_getLogs" || endpoint.logs);
    if (candidates.length === 0) throw new Error("No configured RPC endpoint supports eth_getLogs");
    let lastError = "RPC request failed";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const endpoint = candidates[attempt % candidates.length];
      if (!endpoint) break;
      const now = Date.now();
      const minimumStart = Math.max(lastRequestAt + 80, method === "eth_getLogs" ? lastLogsAt + 500 : 0);
      if (minimumStart > now) await sleep(minimumStart - now);
      lastRequestAt = Date.now();
      if (method === "eth_getLogs") lastLogsAt = lastRequestAt;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      try {
        const response = await fetcher(endpoint.url, {
          method: "POST",
          headers: { "content-type": "application/json", "user-agent": "gptheist/1.1 read-only" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
          signal: controller.signal
        });
        const text = await response.text();
        if (response.status === 429 || response.status === 503) {
          lastError = `RPC HTTP ${response.status}`;
          await sleep(retryDelayMs * 2 ** attempt);
          continue;
        }
        if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
        let value: { result?: unknown; error?: { message?: string } };
        try {
          value = JSON.parse(text) as { result?: unknown; error?: { message?: string } };
        } catch {
          throw new Error("RPC returned invalid JSON");
        }
        if (value.error) throw new Error(value.error.message ?? "RPC request failed");
        if (!("result" in value)) throw new Error("RPC response is missing result");
        return value.result;
      } catch (error: unknown) {
        lastError = error instanceof Error ? error.message : lastError;
        if (attempt < 4) await sleep(retryDelayMs * 2 ** attempt);
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`${method} failed after bounded retries: ${lastError}`);
  };
}

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { ...SECURITY_HEADERS, "content-type": type, "cache-control": type.includes("html") ? "no-store" : "no-cache" });
  response.end(body);
}

export function createDeskServer(options: DeskServerOptions = {}): Server {
  const rpc = options.rpc ?? createHttpRpcCaller(options.rpcUrl);
  const root = resolve(options.assetsRoot ?? DEFAULT_ASSETS);
  const cacheMs = options.cacheMs ?? 4_000;
  const failureCacheMs = options.failureCacheMs ?? 15_000;
  let cached: { at: number; value: LiveSnapshot } | null = null;
  let cachedFailure: { at: number; message: string } | null = null;
  let pending: Promise<LiveSnapshot> | null = null;
  const snapshot = async (): Promise<LiveSnapshot> => {
    if (cached && Date.now() - cached.at < cacheMs) return cached.value;
    if (cachedFailure && Date.now() - cachedFailure.at < failureCacheMs) throw new Error(cachedFailure.message);
    if (!pending) {
      pending = fetchLiveSnapshot(rpc).then((value) => {
        cached = { at: Date.now(), value };
        cachedFailure = null;
        return value;
      }).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "upstream unavailable";
        cachedFailure = { at: Date.now(), message };
        throw error;
      }).finally(() => { pending = null; });
    }
    return pending;
  };
  const assets: Record<string, [string, string]> = {
    "/": ["index.html", "text/html; charset=utf-8"],
    "/index.html": ["index.html", "text/html; charset=utf-8"],
    "/desk.css": ["desk.css", "text/css; charset=utf-8"],
    "/desk.js": ["desk.js", "text/javascript; charset=utf-8"]
  };

  return createServer(async (request, response) => {
    try {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      if (request.method !== "GET") {
        send(response, 405, "application/json; charset=utf-8", JSON.stringify({ error: "method not allowed" }));
        return;
      }
      if (path === "/health") {
        send(response, 200, "application/json; charset=utf-8", JSON.stringify({ status: "ok", mode: "read-only", chainId: ROBINHOOD_CHAIN_ID }));
        return;
      }
      if (path === "/api/snapshot") {
        try {
          send(response, 200, "application/json; charset=utf-8", JSON.stringify(await snapshot()));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message.slice(0, 200) : "upstream unavailable";
          send(response, 502, "application/json; charset=utf-8", JSON.stringify({ error: message, mode: "read-only" }));
        }
        return;
      }
      const asset = assets[path];
      if (!asset) {
        send(response, 404, "text/plain; charset=utf-8", "Not found\n");
        return;
      }
      send(response, 200, asset[1], await readFile(resolve(root, asset[0]), "utf8"));
    } catch {
      send(response, 500, "text/plain; charset=utf-8", "Internal error\n");
    }
  });
}

export async function startDeskServer(options: DeskServerOptions & { host?: string; port?: number } = {}): Promise<Server> {
  const server = createDeskServer(options);
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4173;
  server.listen(port, host);
  await new Promise<void>((resolveReady, reject) => {
    server.once("listening", resolveReady);
    server.once("error", reject);
  });
  return server;
}
