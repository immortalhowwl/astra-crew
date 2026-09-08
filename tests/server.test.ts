import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { createDeskServer, createHttpRpcCaller } from "../src/server.js";
import { TOKEN_LAUNCHED_TOPIC } from "../src/live.js";

const word = (value: string): string => value.replace(/^0x/, "").padStart(64, "0");
const topic = (value: string): `0x${string}` => `0x${word(value)}`;

function fakeRpc(method: string): Promise<unknown> {
  if (method === "eth_chainId") return Promise.resolve("0x1237");
  if (method === "eth_blockNumber") return Promise.resolve("0x2000");
  if (method === "eth_getLogs") return Promise.resolve([{
    address: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
    blockNumber: "0x1fff",
    transactionHash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    logIndex: "0x0",
    topics: [TOKEN_LAUNCHED_TOPIC, topic("0x1111111111111111111111111111111111111111"), topic("0x2222222222222222222222222222222222222222"), topic("0x3333333333333333333333333333333333333333")],
    data: `0x${word("0x0000000000000000000000000000000000000000")}${word("0x0")}${word("0x3a4")}`
  }]);
  return Promise.reject(new Error(`unexpected method ${method}`));
}

test("HTTP RPC caller recovers from a 429 with bounded retry", async () => {
  let attempts = 0;
  const fakeFetch = async (): Promise<Response> => {
    attempts += 1;
    if (attempts === 1) return new Response("rate limited", { status: 429 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: "0x1237" }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  const rpc = createHttpRpcCaller("https://example.invalid", { fetch: fakeFetch as typeof fetch, retryDelayMs: 0 });
  assert.equal(await rpc("eth_chainId"), "0x1237");
  assert.equal(attempts, 2);
});

test("Desk caches upstream failures so clients cannot amplify RPC retries", async (t) => {
  let calls = 0;
  const failingRpc = async (): Promise<unknown> => {
    calls += 1;
    throw new Error("upstream unavailable");
  };
  const server = createDeskServer({ rpc: failingRpc, failureCacheMs: 60_000 });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const first = await fetch(`http://127.0.0.1:${port}/api/snapshot`);
  const second = await fetch(`http://127.0.0.1:${port}/api/snapshot`);
  assert.equal(first.status, 502);
  assert.equal(second.status, 502);
  assert.equal(calls, 1);
});

test("Desk exposes bounded read-only X profile research without arbitrary outbound URLs", async (t) => {
  const socialFetch = async (url: string | URL | Request): Promise<Response> => {
    assert.equal(String(url), "https://api.fxtwitter.com/researchcat");
    return new Response(JSON.stringify({ code: 200, user: {
      screen_name: "researchcat", name: "Research Cat", followers: 321,
      joined: "Sat Dec 16 05:10:35 +0000 2023", protected: false,
      verification: { verified: true, type: "individual" }
    } }), { status: 200 });
  };
  const server = createDeskServer({ rpc: fakeRpc, socialFetch: socialFetch as typeof fetch });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const valid = await fetch(`${base}/api/social?handle=researchcat`);
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), {
    status: "PUBLIC_PROFILE", handle: "researchcat", name: "Research Cat", followers: 321,
    joined: "Sat Dec 16 05:10:35 +0000 2023", protected: false, verified: true,
    source: "FxTwitter public profile mirror"
  });
  assert.equal((await fetch(`${base}/api/social?handle=https://evil.example`)).status, 400);
});

test("Desk serves the UI, health, and a read-only live snapshot with defensive headers", async (t) => {
  const server = createDeskServer({ rpc: fakeRpc });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const base = `http://127.0.0.1:${port}`;

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /GPTHEIST DESK/);
  const productPage = await fetch(`${base}/`);
  const productHtml = await productPage.text();
  assert.match(productHtml, /SCORE \/ 100/);
  assert.match(productHtml, /data-filter="WATCH"/);
  assert.match(productHtml, /EVIDENCE/);
  assert.match(productHtml, /id="pons-link"/);
  assert.match(productHtml, /id="token-link"/);
  assert.match(productHtml, /id="tx-link"/);
  assert.doesNotMatch(productHtml, /GET \$GPTHEIST/);
  assert.doesNotMatch(productHtml, /https:\/\/x\.com\/GPTHEIST/);
  assert.match(productHtml, /TARGET DOSSIER/);
  assert.match(productHtml, /SOCIAL FOOTPRINT/);
  assert.match(productHtml, /DEPLOYER RECORD/);
  assert.match(productHtml, /LIQUIDITY STATE/);
  assert.match(productHtml, /ROADMAP/);
  assert.match(productHtml, /https:\/\/x\.com\/immortalhowwl/);
  assert.match(productHtml, /https:\/\/github\.com\/immortalhowwl\/gptheist/);

  for (const route of ["trace", "crew", "method", "vault"]) {
    const roomPage = await fetch(`${base}/${route}`);
    assert.equal(roomPage.status, 200);
    const roomHtml = await roomPage.text();
    assert.match(roomHtml, /GPTHEIST/);
    assert.match(roomHtml, /data-room="trace"/);
    assert.match(roomHtml, /data-room="crew"/);
    assert.match(roomHtml, /data-room="method"/);
    assert.match(roomHtml, /data-room="vault"/);
  }
  const roomsScript = await (await fetch(`${base}/rooms.js`)).text();
  assert.match(roomsScript, /\/api\/snapshot/);
  assert.match(roomsScript, /HANDOFF|handoff-chord/i);
  assert.doesNotMatch(roomsScript, /innerHTML|insertAdjacentHTML|wallet|eth_sendTransaction/);

  const deskScript = await (await fetch(`${base}/desk.js`)).text();
  assert.match(deskScript, /ponsfamily\.com\/launchpad/);
  assert.match(deskScript, /robinhoodchain\.blockscout\.com\/address/);
  assert.match(deskScript, /robinhoodchain\.blockscout\.com\/tx/);
  assert.match(deskScript, /deployerResearch/);
  assert.match(deskScript, /realQuoteReserve/);
  assert.match(deskScript, /\/api\/social\?handle=/);
  assert.doesNotMatch(deskScript, /get-token/);
  assert.doesNotMatch(deskScript, /dblclick/);

  const deskCss = await (await fetch(`${base}/desk.css`)).text();
  assert.match(deskCss, /\.agent small\{[^}]*bottom:7px/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);

  const health = await fetch(`${base}/health`);
  assert.deepEqual(await health.json(), { status: "ok", mode: "read-only", chainId: 4663 });

  const snapshot = await fetch(`${base}/api/snapshot`);
  assert.equal(snapshot.status, 200);
  const body = await snapshot.json() as { mode: string; launches: unknown[] };
  assert.equal(body.mode, "read-only");
  assert.equal(body.launches.length, 1);

  const traversal = await fetch(`${base}/..%2F..%2Fetc%2Fpasswd`);
  assert.equal(traversal.status, 404);
});
