import assert from "node:assert/strict";
import test from "node:test";
import { encodeFunctionResult, parseAbi } from "viem";
import { decodeTokenLaunchedLog, fetchLiveSnapshot, TOKEN_LAUNCHED_TOPIC } from "../src/live.js";
import { MULTICALL3, assessPonsLaunch, decodePonsMarketState } from "../src/market.js";

const word = (value: string): string => value.replace(/^0x/, "").padStart(64, "0");
const addressTopic = (address: string): `0x${string}` => `0x${word(address)}`;

const boolWord = (value: boolean): string => word(value ? "0x1" : "0x0");
const uintWord = (value: string): string => BigInt(value).toString(16).padStart(64, "0");
const multicallAbi = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"
]);

test("scores verified ETH launches for watchlisting with inspectable reasons", () => {
  const assessment = assessPonsLaunch("ETH", {
    status: "VERIFIED",
    creatorFeeRecipient: "0x3333333333333333333333333333333333333333",
    creatorTaxBps: 100,
    buybackEnabled: false,
    phase: "CURVE",
    quoteReserve: "1680000000000000000",
    tokenReserve: "970000000000000000000000000",
    realQuoteReserve: "2100000000000000000",
    graduationThreshold: "4200000000000000000",
    progressBps: 5000,
    currentSnipeTaxBps: 0
  });
  assert.equal(assessment.verdict, "WATCH");
  assert.equal(assessment.score, 100);
  assert.match(assessment.reasons.join(" "), /verified factory provenance/i);
  assert.match(assessment.reasons.join(" "), /current snipe tax/i);
  assert.doesNotMatch(assessment.reasons.join(" "), /opening tax/i);
  assert.match(assessment.unknowns.join(" "), /social/i);
});

test("vetoes unsupported pairs and unavailable evidence with explicit blockers", () => {
  const unsupported = assessPonsLaunch("OTHER", {
    status: "VERIFIED",
    creatorFeeRecipient: "0x3333333333333333333333333333333333333333",
    creatorTaxBps: 0,
    buybackEnabled: false,
    phase: "CURVE",
    quoteReserve: "1",
    tokenReserve: "1",
    realQuoteReserve: "0",
    graduationThreshold: "10",
    progressBps: 0,
    currentSnipeTaxBps: 0
  });
  assert.equal(unsupported.verdict, "VETO");
  assert.match(unsupported.blockers.join(" "), /unsupported pair/i);

  const unavailable = assessPonsLaunch("ETH", { status: "UNAVAILABLE", reason: "RPC timeout" });
  assert.deepEqual(unavailable, {
    verdict: "VETO",
    score: 0,
    reasons: [],
    blockers: ["Market evidence unavailable: RPC timeout"],
    unknowns: ["Executable slippage and social quality are not measured"]
  });
});

test("decodes pinned Pons factory and curve reads into verified market evidence", () => {
  const launch = {
    token: "0x1111111111111111111111111111111111111111",
    curve: "0x2222222222222222222222222222222222222222",
    deployer: "0x3333333333333333333333333333333333333333",
    pairToken: "0x0000000000000000000000000000000000000000",
    launchConfigId: "0",
    graduationThreshold: "4200000000000000000",
    blockNumber: 4660,
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: 2
  };
  const factoryRecord = `0x${[
    word(launch.token), word(launch.curve), word(launch.deployer),
    word("0x4444444444444444444444444444444444444444"), word(launch.pairToken),
    uintWord(launch.graduationThreshold), word("0x0"), word("0xc8"), word("0x64"),
    boolWord(true), word("0x0"), word("0x0"), word("0x0"), word("0x0"), boolWord(true)
  ].join("")}`;

  assert.deepEqual(decodePonsMarketState(launch, {
    factoryRecord,
    reserves: `0x${uintWord("1680000000000000000")}${uintWord("970000000000000000000000000")}`,
    realQuoteReserve: `0x${uintWord("2100000000000000000")}`,
    currentSnipeTaxBps: `0x${word("0x0")}`
  }), {
    status: "VERIFIED",
    creatorFeeRecipient: "0x4444444444444444444444444444444444444444",
    creatorTaxBps: 100,
    buybackEnabled: true,
    phase: "CURVE",
    quoteReserve: "1680000000000000000",
    tokenReserve: "970000000000000000000000000",
    realQuoteReserve: "2100000000000000000",
    graduationThreshold: "4200000000000000000",
    progressBps: 5000,
    currentSnipeTaxBps: 0
  });
});

test("decodes a Pons TokenLaunched log into a read-only market observation", () => {
  const token = "0x1111111111111111111111111111111111111111";
  const curve = "0x2222222222222222222222222222222222222222";
  const deployer = "0x3333333333333333333333333333333333333333";
  const pairToken = "0x0000000000000000000000000000000000000000";
  const decoded = decodeTokenLaunchedLog({
    address: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
    blockNumber: "0x1234",
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: "0x2",
    topics: [TOKEN_LAUNCHED_TOPIC, addressTopic(token), addressTopic(curve), addressTopic(deployer)],
    data: `0x${word(pairToken)}${word("0x0")}${word("0x3a4")}`
  });

  assert.deepEqual(decoded, {
    token,
    curve,
    deployer,
    pairToken,
    launchConfigId: "0",
    graduationThreshold: "932",
    blockNumber: 4660,
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: 2
  });
});

test("rejects malformed, unrelated, and spoofed-factory logs instead of inventing launch data", () => {
  assert.equal(decodeTokenLaunchedLog({} as never), null);
  assert.equal(decodeTokenLaunchedLog({
    address: "0x0",
    blockNumber: "0x1",
    transactionHash: "0x1",
    logIndex: "0x0",
    topics: ["0xdeadbeef"],
    data: "0x"
  }), null);

  assert.equal(decodeTokenLaunchedLog({
    address: "0x1111111111111111111111111111111111111111",
    blockNumber: "0x1",
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: "0x0",
    topics: [
      TOKEN_LAUNCHED_TOPIC,
      addressTopic("0x1111111111111111111111111111111111111111"),
      addressTopic("0x2222222222222222222222222222222222222222"),
      addressTopic("0x3333333333333333333333333333333333333333")
    ],
    data: `0x${word("0x0000000000000000000000000000000000000000")}${word("0x0")}${word("0x3a4")}`
  }), null);
});

test("rejects ABI address topics with non-zero upper padding", () => {
  const token = "0x1111111111111111111111111111111111111111";
  const decoded = decodeTokenLaunchedLog({
    address: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
    blockNumber: "0x1",
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: "0x0",
    topics: [
      TOKEN_LAUNCHED_TOPIC,
      `0x${"f".repeat(24)}${token.slice(2)}`,
      addressTopic("0x2222222222222222222222222222222222222222"),
      addressTopic("0x3333333333333333333333333333333333333333")
    ],
    data: `0x${word("0x0000000000000000000000000000000000000000")}${word("0x0")}${word("0x3a4")}`
  });
  assert.equal(decoded, null);
});

test("rejects ABI address topics without the canonical 0x prefix", () => {
  const token = "0x1111111111111111111111111111111111111111";
  const decoded = decodeTokenLaunchedLog({
    address: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
    blockNumber: "0x1",
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: "0x0",
    topics: [
      TOKEN_LAUNCHED_TOPIC,
      `aa${word(token)}`,
      addressTopic("0x2222222222222222222222222222222222222222"),
      addressTopic("0x3333333333333333333333333333333333333333")
    ],
    data: `0x${word("0x0000000000000000000000000000000000000000")}${word("0x0")}${word("0x3a4")}`
  });
  assert.equal(decoded, null);
});

test("rejects ABI address data words with non-zero upper padding", () => {
  const decoded = decodeTokenLaunchedLog({
    address: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
    blockNumber: "0x1",
    transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    logIndex: "0x0",
    topics: [
      TOKEN_LAUNCHED_TOPIC,
      addressTopic("0x1111111111111111111111111111111111111111"),
      addressTopic("0x2222222222222222222222222222222222222222"),
      addressTopic("0x3333333333333333333333333333333333333333")
    ],
    data: `0x${"f".repeat(24)}${"0".repeat(40)}${word("0x0")}${word("0x3a4")}`
  });
  assert.equal(decoded, null);
});

test("fetches real-shaped Robinhood logs and turns each launch into ten inspectable handoffs", async () => {
  const token = "0x1111111111111111111111111111111111111111";
  const curve = "0x2222222222222222222222222222222222222222";
  const deployer = "0x3333333333333333333333333333333333333333";
  const methods: string[] = [];
  const rpc = async (method: string): Promise<unknown> => {
    methods.push(method);
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_blockNumber") return "0x2000";
    if (method === "eth_getLogs") return [{
      address: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
      blockNumber: "0x1fff",
      transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      logIndex: "0x0",
      topics: [TOKEN_LAUNCHED_TOPIC, addressTopic(token), addressTopic(curve), addressTopic(deployer)],
      data: `0x${word("0x0000000000000000000000000000000000000000")}${word("0x0")}${word("0x3a4")}`
    }];
    throw new Error(`unexpected method ${method}`);
  };

  const snapshot = await fetchLiveSnapshot(rpc, { blockWindow: 100 });
  assert.equal(snapshot.chainId, 4663);
  assert.equal(snapshot.headBlock, 8192);
  assert.equal(snapshot.source, "Robinhood Chain RPC");
  assert.equal(snapshot.mode, "read-only");
  assert.equal(snapshot.launches.length, 1);
  assert.equal(snapshot.launches[0]?.verdict, "VETO");
  assert.equal(snapshot.launches[0]?.handoffs.length, 10);
  assert.equal(snapshot.launches[0]?.handoffs[8]?.agent, "PALERMO");
  assert.equal(snapshot.launches[0]?.handoffs[8]?.outcome, "VETO");
  assert.match(snapshot.launches[0]?.handoffs[8]?.message ?? "", /market evidence unavailable/i);
  assert.equal(snapshot.launches[0]?.handoffs[9]?.message.includes("no order"), true);
  assert.equal(snapshot.launches[0]?.market.status, "UNAVAILABLE");
  assert.deepEqual(methods, ["eth_chainId", "eth_blockNumber", "eth_getLogs", "eth_call"]);
});

test("fetches market evidence with read-only calls pinned to the snapshot head", async () => {
  const token = "0x1111111111111111111111111111111111111111";
  const curve = "0x2222222222222222222222222222222222222222";
  const deployer = "0x3333333333333333333333333333333333333333";
  const pair = "0x0000000000000000000000000000000000000000";
  const calls: Array<{ method: string; params?: unknown[] }> = [];
  const factoryRecord = `0x${[
    word(token), word(curve), word(deployer), word(deployer), word(pair),
    uintWord("4200000000000000000"), word("0x0"), word("0xc8"), word("0x64"),
    boolWord(false), word("0x0"), word("0x0"), word("0x0"), word("0x0"), boolWord(true)
  ].join("")}`;
  const rpc = async (method: string, params?: unknown[]): Promise<unknown> => {
    calls.push(params === undefined ? { method } : { method, params });
    if (method === "eth_chainId") return "0x1237";
    if (method === "eth_blockNumber") return "0x2000";
    if (method === "eth_getLogs") return [{
      address: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e",
      blockNumber: "0x1fff",
      transactionHash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      logIndex: "0x0",
      topics: [TOKEN_LAUNCHED_TOPIC, addressTopic(token), addressTopic(curve), addressTopic(deployer)],
      data: `0x${word(pair)}${word("0x0")}${uintWord("4200000000000000000")}`
    }];
    if (method === "eth_call") {
      const request = params?.[0] as { to: string; data: string };
      assert.equal(params?.[1], "0x2000");
      assert.equal(request.to.toLowerCase(), MULTICALL3);
      return encodeFunctionResult({
        abi: multicallAbi,
        functionName: "aggregate3",
        result: [
          { success: true, returnData: factoryRecord as `0x${string}` },
          { success: true, returnData: `0x${uintWord("1680000000000000000")}${uintWord("970000000000000000000000000")}` as `0x${string}` },
          { success: true, returnData: `0x${uintWord("2100000000000000000")}` as `0x${string}` },
          { success: true, returnData: `0x${word("0x0")}` as `0x${string}` }
        ]
      });
    }
    throw new Error(`unexpected method ${method}`);
  };

  const snapshot = await fetchLiveSnapshot(rpc, { blockWindow: 100 });
  assert.equal(snapshot.launches[0]?.market.status, "VERIFIED");
  assert.equal(snapshot.launches[0]?.market.status === "VERIFIED" && snapshot.launches[0].market.progressBps, 5000);
  assert.match(snapshot.launches[0]?.handoffs[4]?.message ?? "", /factory record and curve state verified/i);
  assert.match(snapshot.launches[0]?.handoffs[5]?.message ?? "", /50\.00% curve progress/i);
  assert.equal(calls.filter((call) => call.method === "eth_call").length, 1);
});
