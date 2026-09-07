<p align="center">
  <img src="./assets/avatar.jpg" alt="GPTHEIST" width="128">
</p>
<p align="center">
  <img src="./assets/banner.jpg" alt="GPTHEIST — Ten agents. One decision." width="100%">
</p>

<p align="center">
  <strong>Ten agents pass one market decision forward. Any one of them can kill it.</strong>
</p>

<p align="center">
  <a href="https://github.com/immortalhowwl/gptheist/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/immortalhowwl/gptheist/actions/workflows/ci.yml/badge.svg"></a>
  <img alt="mode" src="https://img.shields.io/badge/mode-paper--only-e5484d">
  <img alt="runtime dependencies" src="https://img.shields.io/badge/runtime%20dependencies-0-f4efe6">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-f4efe6">
</p>

GPTHEIST is a deterministic, inspectable market-replay CLI inspired by the ten-agent operating system described by [@immortalhowwl](https://x.com/immortalhowwl). Each specialist owns one gate. Every handoff is visible. Palermo can veto the run. Professor returns one final decision.

It is intentionally **paper-only**: no wallet connection, private key, signing, RPC, brokerage integration, or live order execution exists in this repository.

## Sixty seconds

Requires Node.js 18 or newer.

```bash
git clone https://github.com/immortalhowwl/gptheist.git
cd gptheist
npm install
npm run demo
```

The demo is fully offline and uses the bundled `fixtures/success.json` replay.

```text
GPTHEIST — PAPER-TRADING REPLAY
Safety: simulation only; no wallet, signing, private keys, or live execution.

[2026-01-15T12:00:00.000Z] TOKYO      INFO :: Scout — Observed BTC-USD at 100000.00 from bundled replay data.
[2026-01-15T12:00:01.000Z] BERLIN     INFO :: Planner / criteria — Criteria locked: momentum >= 0.55, social quality >= 0.50/100 samples, liquidity >= $1m, slippage <= 25 bps.
[2026-01-15T12:00:02.000Z] RIO        PASS :: Technical / chart analysis — Momentum score 0.72.
[2026-01-15T12:00:03.000Z] DENVER     PASS :: Social-signal quality — Social score 0.66 across 250 fixture samples.
[2026-01-15T12:00:04.000Z] LISBON     PASS :: Data / handoff validation — Fixture schema validated; ordered handoff continuity is structurally enforced.
[2026-01-15T12:00:05.000Z] STOCKHOLM  PASS :: Liquidity / slippage / position sizing — Liquidity $5000000; slippage 8 bps; simulated size 1.50%.
[2026-01-15T12:00:06.000Z] NAIROBI    INFO :: Signal brief — Brief: technical, social, data, and sizing checks cleared.
[2026-01-15T12:00:07.000Z] HELSINKI   INFO :: Append-only audit / logistics — Audit trace 9d64be648f8a52d3 prepared; execution remains disabled.
[2026-01-15T12:00:08.000Z] PALERMO    PASS :: Red-team veto gate — Red-team gate found no policy violation.
[2026-01-15T12:00:09.000Z] PROFESSOR  PASS :: Final coordinator / decision — Approved for paper simulation only; no order was sent.

FINAL: PASS — approved (paper-only; executed=false)
Paper trade: BUY 1.50% BTC-USD @ 100000.00
Audit: runs/9d64be648f8a52d3.jsonl
```

## Commands

| Command | What it does |
|---|---|
| `npm run demo` | Builds and runs the bundled safe replay |
| `node dist/src/cli.js replay fixtures/veto.json` | Replays any local fixture and writes an audit log |
| `node dist/src/cli.js agents` | Lists all ten roles and boundaries |
| `node dist/src/cli.js doctor` | Checks Node, fixture access, logs, dependencies, and execution mode |
| `npm test` | Builds and runs the complete test suite |

After `npm link`, use the shorter binary form:

```bash
gptheist demo
gptheist replay fixtures/veto.json
gptheist agents
gptheist doctor
```

## The handoff

```text
TOKYO → BERLIN → RIO → DENVER → LISBON
  → STOCKHOLM → NAIROBI → HELSINKI
  → PALERMO (PASS / VETO) → PROFESSOR
```

1. **Tokyo** frames the observation.
2. **Berlin** locks the criteria before analysis.
3. **Rio** checks technical context.
4. **Denver** grades the supplied social signal.
5. **Lisbon** validates data and handoffs.
6. **Stockholm** checks liquidity, slippage, and simulated size.
7. **Nairobi** compresses the cleared signals.
8. **Helsinki** prepares an append-only trace.
9. **Palermo** attempts to stop unsafe work.
10. **Professor** returns the final paper-only decision.

See [`docs/AGENTS.md`](docs/AGENTS.md) for responsibilities and approval boundaries.

## Replay your own fixture

Copy a bundled fixture and edit its observation fields:

```bash
cp fixtures/success.json my-replay.json
npm run build
node dist/src/cli.js replay my-replay.json
```

Every input is local JSON. GPTHEIST does not fetch market data. Fixtures are schema-validated before the first handoff, and terminal control characters are escaped. Identical input under the same policy version produces the same run ID, handoffs, timestamps, and final decision. Audit records are written to `runs/<run-id>.jsonl`. Existing records are immutable: the CLI refuses to overwrite a run ID with different content.

A run is vetoed when any configured boundary fails, including:

- incomplete or invalid replay data;
- momentum below `0.55`;
- social quality below `0.50` or fewer than `100` fixture samples;
- liquidity below `$1,000,000`;
- estimated slippage above `25 bps`;
- requested size outside its explicit cap;
- any supplied risk flag.

These thresholds are demonstration rules, not trading advice or validated predictors.

## What this is not

- not ten live LLM instances;
- not evidence that a historical trade happened;
- not a backtesting engine or profit calculator;
- not connected to Robinhood, an exchange, a wallet, or a blockchain;
- not able to place, sign, route, or settle orders.

It is an open, deterministic reference implementation of the **ownership → handoff → veto → final decision** pattern. Use it to inspect and extend the coordination logic before connecting any external system.

## Development

```bash
npm install
npm test
npm run build
npm pack --dry-run
```

The project has zero runtime dependencies. TypeScript and Node type definitions are development dependencies only. CI tests Node 18 and Node 20.

## Safety

Never put secrets or private keys into fixtures. This project has no live execution path. Any future integration that can publish, spend, sign, delete, or move money must remain behind explicit human approval and should be reviewed independently.

## License

MIT © [@immortalhowwl](https://x.com/immortalhowwl)
