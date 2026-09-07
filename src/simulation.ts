import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

export const AGENTS = [
  { name: "TOKYO", role: "Scout", responsibility: "Frames the replay observation without fetching or executing live trades." },
  { name: "BERLIN", role: "Planner / criteria", responsibility: "Sets explicit paper-trade approval criteria before analysis." },
  { name: "RIO", role: "Technical / chart analysis", responsibility: "Evaluates fixture-provided momentum and price context." },
  { name: "DENVER", role: "Social-signal quality", responsibility: "Grades the supplied social signal and sample quality." },
  { name: "LISBON", role: "Data / handoff validation", responsibility: "Rejects incomplete or malformed replay inputs and handoffs." },
  { name: "STOCKHOLM", role: "Liquidity / slippage / position sizing", responsibility: "Caps simulated size and checks liquidity and estimated slippage." },
  { name: "NAIROBI", role: "Signal brief", responsibility: "Compresses cleared signals into a concise decision brief." },
  { name: "HELSINKI", role: "Append-only audit / logistics", responsibility: "Records the immutable decision trace and paper-only boundary." },
  { name: "PALERMO", role: "Red-team veto gate", responsibility: "Vetoes unsafe, incomplete, contradictory, or out-of-policy signals." },
  { name: "PROFESSOR", role: "Final coordinator / decision", responsibility: "Issues the final approved or rejected paper-trade decision; never executes." }
] as const;

export const EXECUTION_MODE = "paper-only" as const;
const POLICY_VERSION = 2;

export type AgentName = (typeof AGENTS)[number]["name"];
export type AgentOutcome = "PASS" | "VETO" | "INFO";

export interface ReplayFixture {
  schemaVersion: 1;
  id: string;
  seed: number;
  observedAt: string;
  market: string;
  price: number;
  momentum: number;
  socialSignal: number;
  socialSampleSize: number;
  dataComplete: boolean;
  liquidityUsd: number;
  estimatedSlippageBps: number;
  requestedPositionPct: number;
  maxPositionPct: number;
  riskFlags: string[];
}

export interface AgentHandoff {
  sequence: number;
  timestamp: string;
  agent: AgentName;
  role: string;
  outcome: AgentOutcome;
  message: string;
}

export interface SimulationResult {
  schemaVersion: 1;
  runId: string;
  fixtureId: string;
  mode: typeof EXECUTION_MODE;
  status: "approved" | "rejected";
  decision: "PASS" | "VETO";
  agents: AgentHandoff[];
  paperTrade: {
    executed: false;
    side: "BUY" | "NONE";
    market: string;
    referencePrice: number;
    positionPct: number;
    rationale: string;
  };
}

function invalid(field: string, requirement: string): never {
  throw new Error(`Invalid fixture: ${field} ${requirement}`);
}

function requireBoundedString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 128) {
    invalid(field, "must be a nonempty string of at most 128 characters");
  }
}

function requireFiniteNumber(value: unknown, field: string, minimum: number, maximum: number): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid(field, `must be a finite number from ${minimum} to ${maximum}`);
  }
}

function requireNonnegativeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid(field, "must be a nonnegative safe integer");
  }
}

export function validateFixture(value: unknown): asserts value is ReplayFixture {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("value", "must be a JSON object");
  const fixture = value as Record<string, unknown>;
  if (fixture.schemaVersion !== 1) invalid("schemaVersion", "must be exactly 1");
  requireBoundedString(fixture.id, "id");
  requireNonnegativeInteger(fixture.seed, "seed");
  requireBoundedString(fixture.market, "market");
  requireFiniteNumber(fixture.price, "price", 0, 1_000_000_000_000_000);
  requireFiniteNumber(fixture.momentum, "momentum", 0, 1);
  requireFiniteNumber(fixture.socialSignal, "socialSignal", 0, 1);
  requireNonnegativeInteger(fixture.socialSampleSize, "socialSampleSize");
  if (typeof fixture.dataComplete !== "boolean") invalid("dataComplete", "must be a boolean");
  requireFiniteNumber(fixture.liquidityUsd, "liquidityUsd", 0, 1_000_000_000_000_000);
  requireFiniteNumber(fixture.estimatedSlippageBps, "estimatedSlippageBps", 0, 1_000_000);
  requireFiniteNumber(fixture.requestedPositionPct, "requestedPositionPct", 0, 100);
  requireFiniteNumber(fixture.maxPositionPct, "maxPositionPct", 0, 100);
  if (!Array.isArray(fixture.riskFlags) || fixture.riskFlags.length > 100) {
    invalid("riskFlags", "must be an array of at most 100 strings");
  }
  fixture.riskFlags.forEach((flag) => requireBoundedString(flag, "riskFlags entry"));
  if (typeof fixture.observedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(fixture.observedAt)) {
    invalid("observedAt", "must be an ISO-8601 timestamp");
  }
  const epoch = Date.parse(fixture.observedAt);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== fixture.observedAt) {
    invalid("observedAt", "must be an ISO-8601 timestamp");
  }
}

export function sanitizeTerminal(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`
  );
}

function stableFixture(fixture: ReplayFixture): string {
  return JSON.stringify({ policyVersion: POLICY_VERSION, ...fixture, riskFlags: [...fixture.riskFlags].sort() });
}

function atOffset(observedAt: string, seconds: number): string {
  const epoch = Date.parse(observedAt);
  if (!Number.isFinite(epoch)) throw new Error("observedAt must be an ISO-8601 timestamp");
  return new Date(epoch + seconds * 1000).toISOString();
}

export function runSimulation(fixture: ReplayFixture): SimulationResult {
  validateFixture(fixture);
  const runId = createHash("sha256").update(stableFixture(fixture)).digest("hex").slice(0, 16);
  const displayId = sanitizeTerminal(fixture.id);
  const displayMarket = sanitizeTerminal(fixture.market);
  const displayRiskFlags = fixture.riskFlags.map(sanitizeTerminal);
  const unsafe: string[] = [];
  if (!fixture.dataComplete) unsafe.push("incomplete data");
  if (fixture.price <= 0) unsafe.push("invalid reference price");
  if (fixture.momentum < 0.55) unsafe.push("momentum below criterion");
  if (fixture.socialSignal < 0.5 || fixture.socialSampleSize < 100) unsafe.push("weak social evidence");
  if (fixture.liquidityUsd < 1_000_000) unsafe.push("insufficient liquidity");
  if (fixture.estimatedSlippageBps > 25) unsafe.push("slippage above limit");
  if (fixture.requestedPositionPct <= 0 || fixture.requestedPositionPct > fixture.maxPositionPct) unsafe.push("position outside limit");
  unsafe.push(...displayRiskFlags.map((flag) => `risk flag: ${flag}`));
  const positionPct = Math.max(0, Math.min(fixture.requestedPositionPct, fixture.maxPositionPct));
  const entries: Array<[AgentName, AgentOutcome, string]> = [
    ["TOKYO", "INFO", `Observed ${displayMarket} at ${fixture.price.toFixed(2)} from bundled replay data.`],
    ["BERLIN", "INFO", "Criteria locked: momentum >= 0.55, social quality >= 0.50/100 samples, liquidity >= $1m, slippage <= 25 bps."],
    ["RIO", fixture.momentum >= 0.55 ? "PASS" : "VETO", `Momentum score ${fixture.momentum.toFixed(2)}.`],
    ["DENVER", fixture.socialSignal >= 0.5 && fixture.socialSampleSize >= 100 ? "PASS" : "VETO", `Social score ${fixture.socialSignal.toFixed(2)} across ${fixture.socialSampleSize} fixture samples.`],
    ["LISBON", fixture.dataComplete ? "PASS" : "VETO", fixture.dataComplete ? "Fixture schema validated; ordered handoff continuity is structurally enforced." : "Replay fixture is incomplete."],
    ["STOCKHOLM", fixture.liquidityUsd >= 1_000_000 && fixture.estimatedSlippageBps <= 25 && fixture.requestedPositionPct > 0 && fixture.requestedPositionPct <= fixture.maxPositionPct ? "PASS" : "VETO", `Liquidity $${fixture.liquidityUsd.toFixed(0)}; slippage ${fixture.estimatedSlippageBps} bps; simulated size ${positionPct.toFixed(2)}%.`],
    ["NAIROBI", "INFO", unsafe.length === 0 ? "Brief: technical, social, data, and sizing checks cleared." : `Brief: ${unsafe.length} unresolved concern(s).`],
    ["HELSINKI", "INFO", `Audit trace ${runId} prepared; execution remains disabled.`],
    ["PALERMO", unsafe.length === 0 ? "PASS" : "VETO", unsafe.length === 0 ? "Red-team gate found no policy violation." : `Veto: ${unsafe.join("; ")}.`],
    ["PROFESSOR", unsafe.length === 0 ? "PASS" : "VETO", unsafe.length === 0 ? "Approved for paper simulation only; no order was sent." : "Rejected; no paper position opened and no order was sent."]
  ];
  const agents = entries.map(([agent, outcome, message], index): AgentHandoff => ({
    sequence: index + 1,
    timestamp: atOffset(fixture.observedAt, index),
    agent,
    role: AGENTS[index]?.role ?? "",
    outcome,
    message
  }));
  const approved = unsafe.length === 0;
  return {
    schemaVersion: 1,
    runId,
    fixtureId: displayId,
    mode: EXECUTION_MODE,
    status: approved ? "approved" : "rejected",
    decision: approved ? "PASS" : "VETO",
    agents,
    paperTrade: {
      executed: false,
      side: approved ? "BUY" : "NONE",
      market: displayMarket,
      referencePrice: fixture.price,
      positionPct: approved ? positionPct : 0,
      rationale: approved ? "Approved hypothetical entry; execution intentionally disabled." : "Rejected by safety gate."
    }
  };
}

/** Writes an immutable JSONL trace. Replaying identical input reuses the identical trace. */
export async function writeJsonlLog(result: SimulationResult, directory = "runs"): Promise<string> {
  if (!/^[0-9a-f]{16}$/.test(result.runId)) {
    throw new Error("runId must be lowercase 16-character hex");
  }
  const auditDirectory = resolve(directory);
  const resolvedPath = resolve(auditDirectory, `${result.runId}.jsonl`);
  const relativePath = relative(auditDirectory, resolvedPath);
  if (relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Audit log path must remain inside the audit directory");
  }
  await mkdir(auditDirectory, { recursive: true });
  if (await realpath(auditDirectory) !== auditDirectory) {
    throw new Error("Audit directory must not contain symlinks");
  }
  const path = resolvedPath;
  const handoffs = result.agents.map((handoff) => JSON.stringify({
    type: "handoff",
    runId: result.runId,
    mode: result.mode,
    ...handoff
  }));
  const final = JSON.stringify({
    type: "final",
    schemaVersion: result.schemaVersion,
    runId: result.runId,
    fixtureId: result.fixtureId,
    mode: result.mode,
    status: result.status,
    decision: result.decision,
    paperTrade: result.paperTrade
  });
  const content = `${[...handoffs, final].join("\n")}\n`;
  try {
    await writeFile(path, content, { encoding: "utf8", flag: "wx" });
  } catch (error: unknown) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
    const existing = await readFile(path, "utf8");
    if (existing !== content) throw new Error(`Refusing to overwrite immutable audit log: ${path}`);
  }
  return path;
}
