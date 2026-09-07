import assert from "node:assert/strict";
import test from "node:test";
import { decodeTokenLaunchedLog, fetchLiveSnapshot, TOKEN_LAUNCHED_TOPIC } from "../src/live.js";

const word = (value: string): string => value.replace(/^0x/, "").padStart(64, "0");
const addressTopic = (address: string): `0x${string}` => `0x${word(address)}`;

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
  assert.equal(snapshot.launches[0]?.handoffs[8]?.message.includes("insufficient market evidence"), true);
  assert.equal(snapshot.launches[0]?.handoffs[9]?.message.includes("no order"), true);
  assert.deepEqual(methods, ["eth_chainId", "eth_blockNumber", "eth_getLogs"]);
});
