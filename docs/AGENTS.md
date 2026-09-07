# ASTRA CREW agent contract

ASTRA CREW models ten named responsibilities as deterministic pipeline stages. In this version, an “agent” is an inspectable rules stage, not a live LLM process. Every stage receives the same immutable replay fixture plus prior handoffs.

## Shared rules

1. One stage owns each decision.
2. A handoff contains a timestamp, role, outcome, and reason.
3. Input facts come only from the local fixture.
4. Rejections identify the failed criterion.
5. No stage can connect a wallet, sign, publish, spend, or execute a trade.
6. Professor may approve a paper scenario only. Human approval would still be required for any external action.

## 1. TOKYO — Scout

**Owns:** framing the market observation supplied by the replay fixture.

**Returns:** market, reference price, and source boundary.

**Cannot:** browse, fetch live data, or describe fixture data as current.

## 2. BERLIN — Planner / criteria

**Owns:** locking acceptance criteria before analysis.

**Returns:** the explicit momentum, social, liquidity, slippage, and sizing gates.

**Cannot:** weaken a criterion after seeing the result.

## 3. RIO — Technical / chart analysis

**Owns:** evaluating fixture-provided momentum and price context.

**Returns:** PASS or VETO with the observed score.

**Cannot:** claim a chart was opened or a backtest was run.

## 4. DENVER — Social-signal quality

**Owns:** checking the supplied social score and sample size.

**Returns:** PASS or VETO with both values.

**Cannot:** infer sentiment from X, Telegram, or another live service.

## 5. LISBON — Data / handoff validation

**Owns:** validating required fields and continuity of the handoff.

**Returns:** PASS or VETO with the missing or invalid boundary.

**Cannot:** repair incomplete evidence by guessing.

## 6. STOCKHOLM — Liquidity / slippage / position sizing

**Owns:** checking fixture-provided liquidity, estimated slippage, and simulated size.

**Returns:** PASS or VETO and the capped paper position.

**Cannot:** move funds, access a wallet, or override the configured size limit.

## 7. NAIROBI — Signal brief

**Owns:** compressing cleared and unresolved checks into one brief.

**Returns:** a short countable summary.

**Cannot:** turn unresolved concerns into approval language.

## 8. HELSINKI — Append-only audit / logistics

**Owns:** preparing the trace ID and preserving the paper-only boundary.

**Returns:** the deterministic run ID and audit status.

**Cannot:** rewrite a different trace under an existing run ID.

## 9. PALERMO — Red-team veto gate

**Owns:** trying to stop unsafe, incomplete, contradictory, or out-of-policy signals.

**Returns:** PASS when no violation exists, otherwise VETO with every reason.

**Cannot:** return an unexplained rejection or be bypassed by Professor.

## 10. PROFESSOR — Final coordinator / decision

**Owns:** returning one coherent final status after Palermo.

**Returns:** approved or rejected, always labeled `paper-only` and `executed=false`.

**Cannot:** send an order, claim real performance, or convert a veto into approval.
