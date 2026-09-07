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

test("audit writer rejects run IDs that can escape the audit directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astra-crew-"));
  const result = runSimulation(safeFixture);
  result.runId = "../../outside-log";

  await assert.rejects(writeJsonlLog(result, directory), /runId must be lowercase 16-character hex/);
});

test("runtime schema validation rejects missing fields, wrong types, and out-of-range values", () => {
  const malformed: unknown[] = [
    { ...safeFixture, schemaVersion: 2 },
    { ...safeFixture, id: 7 },
    { ...safeFixture, id: "" },
    { ...safeFixture, id: "x".repeat(129) },
    { ...safeFixture, market: "" },
    { ...safeFixture, market: "x".repeat(129) },
    { ...safeFixture, seed: -1 },
    { ...safeFixture, seed: 1.5 },
    { ...safeFixture, price: -1 },
    { ...safeFixture, momentum: 1.01 },
    { ...safeFixture, socialSignal: -0.01 },
    { ...safeFixture, socialSampleSize: -1 },
    { ...safeFixture, socialSampleSize: 1.5 },
    { ...safeFixture, dataComplete: "true" },
    { ...safeFixture, liquidityUsd: -1 },
    { ...safeFixture, estimatedSlippageBps: -1 },
    { ...safeFixture, requestedPositionPct: 101 },
    { ...safeFixture, maxPositionPct: 101 },
    { ...safeFixture, riskFlags: "none" },
    { ...safeFixture, riskFlags: [7] },
    { ...safeFixture, riskFlags: ["x".repeat(129)] },
    Object.fromEntries(Object.entries(safeFixture).filter(([key]) => key !== "market"))
  ];

  for (const fixture of malformed) {
    assert.throws(() => runSimulation(fixture as ReplayFixture), /^Error: Invalid fixture:/);
  }
});

test("runtime schema validation rejects every non-finite numeric field", () => {
  const numericFields = [
    "seed", "price", "momentum", "socialSignal", "socialSampleSize", "liquidityUsd",
    "estimatedSlippageBps", "requestedPositionPct", "maxPositionPct"
  ] as const;

  for (const field of numericFields) {
    assert.throws(
      () => runSimulation({ ...safeFixture, [field]: Number.POSITIVE_INFINITY }),
      new RegExp(`Invalid fixture: ${field}`)
    );
    assert.throws(
      () => runSimulation({ ...safeFixture, [field]: Number.NaN }),
      new RegExp(`Invalid fixture: ${field}`)
    );
  }
});

test("observedAt requires a real canonical UTC ISO-8601 timestamp", () => {
  for (const observedAt of [
    "2026-01-15",
    "2026-01-15T12:00:00Z",
    "2026-01-15T12:00:00.000+00:00",
    "2026-02-30T12:00:00.000Z",
    "not-a-date"
  ]) {
    assert.throws(
      () => runSimulation({ ...safeFixture, observedAt }),
      /Invalid fixture: observedAt must be an ISO-8601 timestamp/
    );
  }
});

test("fixture-derived display strings cannot inject ANSI, newlines, or control characters", async () => {
  const fixture = {
    ...safeFixture,
    id: "fixture\n\u001b[2Jid",
    market: "BTC\r\n\u001b[31m-USD",
    riskFlags: ["danger\t\u009b31mflag"]
  };
  const result = runSimulation(fixture);
  const renderedValues = [
    result.fixtureId,
    result.paperTrade.market,
    ...result.agents.map((handoff) => handoff.message)
  ];

  for (const value of renderedValues) assert.doesNotMatch(value, /[\u0000-\u001f\u007f-\u009f]/);
  assert.match(result.paperTrade.market, /\\u000d\\u000a\\u001b\[31m-USD/);
  assert.equal(fixture.market, "BTC\r\n\u001b[31m-USD");

  const directory = await mkdtemp(join(tmpdir(), "astra-crew-"));
  const records = (await readFile(await writeJsonlLog(result, directory), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as unknown);
  assert.doesNotMatch(JSON.stringify(records), /[\u0000-\u001f\u007f-\u009f]/);
});
