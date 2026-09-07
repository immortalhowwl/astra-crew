import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

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
  mode: "paper-only";
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

function stableFixture(fixture: ReplayFixture): string {
  return JSON.stringify({ ...fixture, riskFlags: [...fixture.riskFlags].sort() });
}

function atOffset(observedAt: string, seconds: number): string {
  const epoch = Date.parse(observedAt);
  if (!Number.isFinite(epoch)) throw new Error("observedAt must be an ISO-8601 timestamp");
  return new Date(epoch + seconds * 1000).toISOString();
}

export function runSimulation(fixture: ReplayFixture): SimulationResult {
  if (fixture.schemaVersion !== 1) throw new Error("Unsupported fixture schemaVersion");
  if (!fixture.id.trim() || !fixture.market.trim()) throw new Error("Fixture id and market are required");
  const runId = createHash("sha256").update(stableFixture(fixture)).digest("hex").slice(0, 16);
  const unsafe: string[] = [];
  if (!fixture.dataComplete) unsafe.push("incomplete data");
  if (fixture.price <= 0) unsafe.push("invalid reference price");
  if (fixture.momentum < 0.55) unsafe.push("momentum below criterion");
  if (fixture.socialSignal < 0.5 || fixture.socialSampleSize < 100) unsafe.push("weak social evidence");
  if (fixture.liquidityUsd < 1_000_000) unsafe.push("insufficient liquidity");
  if (fixture.estimatedSlippageBps > 25) unsafe.push("slippage above limit");
  if (fixture.requestedPositionPct <= 0 || fixture.requestedPositionPct > fixture.maxPositionPct) unsafe.push("position outside limit");
  unsafe.push(...fixture.riskFlags.map((flag) => `risk flag: ${flag}`));
  const positionPct = Math.max(0, Math.min(fixture.requestedPositionPct, fixture.maxPositionPct));
  const entries: Array<[AgentName, AgentOutcome, string]> = [
    ["TOKYO", "INFO", `Observed ${fixture.market} at ${fixture.price.toFixed(2)} from bundled replay data.`],
    ["BERLIN", "INFO", "Criteria locked: momentum >= 0.55, social quality >= 0.50/100 samples, liquidity >= $1m, slippage <= 25 bps."],
    ["RIO", fixture.momentum >= 0.55 ? "PASS" : "VETO", `Momentum score ${fixture.momentum.toFixed(2)}.`],
    ["DENVER", fixture.socialSignal >= 0.5 && fixture.socialSampleSize >= 100 ? "PASS" : "VETO", `Social score ${fixture.socialSignal.toFixed(2)} across ${fixture.socialSampleSize} fixture samples.`],
    ["LISBON", fixture.dataComplete && fixture.price > 0 ? "PASS" : "VETO", fixture.dataComplete ? "Required replay fields and prior handoffs validated." : "Replay fixture is incomplete."],
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
    fixtureId: fixture.id,
    mode: "paper-only",
    status: approved ? "approved" : "rejected",
    decision: approved ? "PASS" : "VETO",
    agents,
    paperTrade: {
      executed: false,
      side: approved ? "BUY" : "NONE",
      market: fixture.market,
      referencePrice: fixture.price,
      positionPct: approved ? positionPct : 0,
      rationale: approved ? "Approved hypothetical entry; execution intentionally disabled." : "Rejected by safety gate."
    }
  };
}

/** Writes an immutable JSONL trace. Replaying identical input reuses the identical trace. */
export async function writeJsonlLog(result: SimulationResult, directory = "runs"): Promise<string> {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${result.runId}.jsonl`);
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
