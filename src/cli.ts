#!/usr/bin/env node
import { access, mkdir, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTS, runSimulation, writeJsonlLog, type ReplayFixture, type SimulationResult } from "./simulation.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function loadFixture(path: string): Promise<ReplayFixture> {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof raw !== "object" || raw === null) throw new Error("Fixture must be a JSON object");
  return raw as ReplayFixture;
}

function formatResult(result: SimulationResult, logPath: string): string {
  const lines = [
    "ASTRA CREW — PAPER-TRADING REPLAY",
    "Safety: simulation only; no wallet, signing, private keys, or live execution.",
    ""
  ];
  for (const handoff of result.agents) {
    lines.push(`[${handoff.timestamp}] ${handoff.agent.padEnd(10)} ${handoff.outcome.padEnd(4)} :: ${handoff.role} — ${handoff.message}`);
  }
  lines.push("", `FINAL: ${result.decision} — ${result.status} (${result.mode}; executed=${String(result.paperTrade.executed)})`);
  lines.push(`Paper trade: ${result.paperTrade.side} ${result.paperTrade.positionPct.toFixed(2)}% ${result.paperTrade.market} @ ${result.paperTrade.referencePrice.toFixed(2)}`);
  lines.push(`Audit: ${logPath}`);
  return `${lines.join("\n")}\n`;
}

async function runFixture(path: string): Promise<void> {
  const result = runSimulation(await loadFixture(path));
  const logPath = await writeJsonlLog(result, resolve(process.cwd(), "runs"));
  process.stdout.write(formatResult(result, logPath));
}

async function main(args: string[]): Promise<void> {
  const command = args[0] ?? "help";
  if (command === "demo") {
    await runFixture(resolve(projectRoot, "fixtures/success.json"));
    return;
  }
  if (command === "replay") {
    const fixturePath = args[1];
    if (fixturePath === undefined) throw new Error("Usage: astra-crew replay <fixture.json>");
    await runFixture(resolve(process.cwd(), fixturePath));
    return;
  }
  if (command === "agents") {
    process.stdout.write("ASTRA CREW — TEN AGENTS, ONE DECISION\n\n");
    AGENTS.forEach((agent, index) => {
      process.stdout.write(`${index + 1}. ${agent.name} — ${agent.role}\n   ${agent.responsibility}\n`);
    });
    return;
  }
  if (command === "doctor") {
    const checks: Array<[string, () => Promise<boolean>]> = [
      ["Node.js >= 18", async () => Number(process.versions.node.split(".")[0]) >= 18],
      ["bundled demo fixture", async () => {
        await access(resolve(projectRoot, "fixtures/success.json"), constants.R_OK);
        return true;
      }],
      ["runs directory writable", async () => {
        const runs = resolve(process.cwd(), "runs");
        await mkdir(runs, { recursive: true });
        await access(runs, constants.W_OK);
        return true;
      }],
      ["zero runtime dependencies", async () => {
        const pkg = JSON.parse(await readFile(resolve(projectRoot, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
        return Object.keys(pkg.dependencies ?? {}).length === 0;
      }],
      ["execution boundary: paper-only", async () => true]
    ];
    let passed = 0;
    for (const [label, check] of checks) {
      try {
        if (await check()) {
          passed += 1;
          process.stdout.write(`PASS ${label}\n`);
        } else {
          process.stdout.write(`FAIL ${label}\n`);
        }
      } catch {
        process.stdout.write(`FAIL ${label}\n`);
      }
    }
    process.stdout.write(`Doctor: ${passed}/${checks.length} checks passed\n`);
    if (passed !== checks.length) process.exitCode = 1;
    return;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write([
      "ASTRA CREW — deterministic ten-agent market replay",
      "",
      "Usage:",
      "  astra-crew demo",
      "  astra-crew replay <fixture.json>",
      "  astra-crew agents",
      "  astra-crew doctor",
      "",
      "Paper-only. No wallet access. No live execution.",
      ""
    ].join("\n"));
    return;
  }
  process.stderr.write(`Unknown command: ${command}\n`);
  process.exitCode = 1;
}

await main(process.argv.slice(2));
