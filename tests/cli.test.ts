import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const cli = new URL("../src/cli.js", import.meta.url);

test("demo runs offline and prints timestamped handoffs plus a paper-only result", () => {
  const output = execFileSync(process.execPath, [cli.pathname, "demo"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.match(output, /ASTRA CREW — PAPER-TRADING REPLAY/);
  assert.match(output, /\[2026-01-15T12:00:00\.000Z\] TOKYO/);
  assert.match(output, /PALERMO\s+PASS/);
  assert.match(output, /FINAL: PASS — approved \(paper-only; executed=false\)/);
  assert.match(output, /Audit: .*\.jsonl/);
});

test("replay accepts a fixture path and Palermo vetoes the unsafe fixture", () => {
  const output = execFileSync(process.execPath, [cli.pathname, "replay", "fixtures/veto.json"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.match(output, /PALERMO\s+VETO/);
  assert.match(output, /FINAL: VETO — rejected \(paper-only; executed=false\)/);
  assert.match(output, /Paper trade: NONE 0\.00%/);
});

test("agents lists every role exactly once", () => {
  const output = execFileSync(process.execPath, [cli.pathname, "agents"], { cwd: process.cwd(), encoding: "utf8" });
  const expected = ["TOKYO", "BERLIN", "RIO", "DENVER", "LISBON", "STOCKHOLM", "NAIROBI", "HELSINKI", "PALERMO", "PROFESSOR"];
  for (const name of expected) assert.equal(output.match(new RegExp(`^\\d+\\. ${name} —`, "gm"))?.length, 1);
});

test("doctor checks Node, fixtures, audit directory, dependencies, and paper-only mode", () => {
  const output = execFileSync(process.execPath, [cli.pathname, "doctor"], { cwd: process.cwd(), encoding: "utf8" });
  assert.match(output, /PASS Node\.js >= 18/);
  assert.match(output, /PASS bundled demo fixture/);
  assert.match(output, /PASS runs directory writable/);
  assert.match(output, /PASS zero runtime dependencies/);
  assert.match(output, /PASS execution boundary: paper-only/);
  assert.match(output, /Doctor: 5\/5 checks passed/);
});
