import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { AGENTS, runSimulation, writeJsonlLog, type ReplayFixture } from "../src/simulation.js";

const safeFixture: ReplayFixture = {
  schemaVersion: 1,
  id: "btc-breakout-safe",
  seed: 42,
  observedAt: "2026-01-15T12:00:00.000Z",
  market: "BTC-USD",
  price: 100000,
  momentum: 0.72,
  socialSignal: 0.66,
  socialSampleSize: 250,
  dataComplete: true,
  liquidityUsd: 5000000,
  estimatedSlippageBps: 8,
  requestedPositionPct: 1.5,
  maxPositionPct: 2,
  riskFlags: []
};

test("safe replay is deterministic and approved for paper trading by all ten agents", () => {
  const first = runSimulation(safeFixture);
  const second = runSimulation(safeFixture);

  assert.deepEqual(first, second);
  assert.equal(first.status, "approved");
  assert.equal(first.mode, "paper-only");
  assert.equal(first.agents.length, 10);
  assert.deepEqual(first.agents.map((step) => step.agent), AGENTS.map((agent) => agent.name));
  assert.equal(new Set(first.agents.map((step) => step.agent)).size, 10);
  assert.equal(first.agents.at(-2)?.agent, "PALERMO");
  assert.equal(first.agents.at(-2)?.outcome, "PASS");
  assert.equal(first.agents.at(-1)?.agent, "PROFESSOR");
});

test("Palermo vetoes an unsafe signal and the JSONL audit is valid", async () => {
  const fixture: ReplayFixture = { ...safeFixture, id: "unsafe", riskFlags: ["unverified-source"] };
  const result = runSimulation(fixture);
  assert.equal(result.status, "rejected");
  assert.equal(result.decision, "VETO");
  assert.equal(result.agents.find((step) => step.agent === "PALERMO")?.outcome, "VETO");
  assert.equal(result.paperTrade.side, "NONE");
  assert.equal(result.paperTrade.executed, false);

  const directory = await mkdtemp(join(tmpdir(), "astra-crew-"));
  const logPath = await writeJsonlLog(result, directory);
  const records = (await readFile(logPath, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as { type: string });
  assert.equal(records.length, 11);
  assert.deepEqual(records.map((record) => record.type), [...Array.from({ length: 10 }, () => "handoff"), "final"]);
});
