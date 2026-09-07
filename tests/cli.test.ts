import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("malformed JSON exits nonzero with one concise error and no stack trace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astra-crew-cli-"));
  const fixturePath = join(directory, "broken.json");
  await writeFile(fixturePath, "{not-json", "utf8");

  const result = spawnSync(process.execPath, [cli.pathname, "replay", fixturePath], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^Error: /);
  assert.equal(result.stderr.trim().split("\n").length, 1);
  assert.doesNotMatch(result.stderr, /\n\s+at /);
});

test("invalid fixture schema exits nonzero with a concise validation error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astra-crew-cli-"));
  const fixturePath = join(directory, "invalid.json");
  await writeFile(fixturePath, JSON.stringify({ schemaVersion: 1, market: "BTC-USD" }), "utf8");

  const result = spawnSync(process.execPath, [cli.pathname, "replay", fixturePath], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^Error: Invalid fixture:/);
  assert.equal(result.stderr.trim().split("\n").length, 1);
});

test("unknown commands cannot inject terminal controls or forged lines", () => {
  const result = spawnSync(process.execPath, [cli.pathname, "bad\u001b[2J\nFORGED"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
  assert.match(result.stderr, /bad\\u001b\[2J\\u000aFORGED/);
  assert.equal(result.stderr.trim().split("\n").length, 1);
});

test("audit paths from control-character working directories are terminal-safe", async () => {
  const root = await mkdtemp(join(tmpdir(), "astra-crew-cli-"));
  const unsafeCwd = join(root, "red\u001b[31mroom");
  await mkdir(unsafeCwd);

  const result = spawnSync(process.execPath, [cli.pathname, "demo"], {
    cwd: unsafeCwd,
    encoding: "utf8"
  });

  assert.equal(result.status, 0);
  assert.doesNotMatch(result.stdout, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
  assert.match(result.stdout, /Audit: .*red\\u001b\[31mroom/);
});
