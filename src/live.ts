import { AGENTS, type AgentHandoff, type AgentOutcome } from "./simulation.js";
import { assessPonsLaunch, readPonsMarketStates, type PonsAssessment, type PonsMarketState } from "./market.js";

export const ROBINHOOD_CHAIN_ID = 4663;
export const PONS_FACTORY = "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e";
export const TOKEN_LAUNCHED_TOPIC = "0x8d4aad4953d0ca700d468f3753aa14432d1b35b43ec6409f051fb6aa43a89607" as const;
export const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";

export interface RpcLog {
  address: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
  topics: string[];
  data: string;
}

export interface LiveLaunch {
  token: string;
  curve: string;
  deployer: string;
  pairToken: string;
  launchConfigId: string;
  graduationThreshold: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}

const ABI_ADDRESS_WORD = /^0{24}[0-9a-fA-F]{40}$/;
const ADDRESS_TOPIC = /^0x0{24}[0-9a-fA-F]{40}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function addressFromWord(word: string): string | null {
  if (!ABI_ADDRESS_WORD.test(word)) return null;
  const address = `0x${word.slice(24)}`.toLowerCase();
  return ADDRESS.test(address) ? address : null;
}

function addressFromTopic(topic: string): string | null {
  return ADDRESS_TOPIC.test(topic) ? addressFromWord(topic.slice(2)) : null;
}

function parseHexInteger(value: string): number | null {
  if (!/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const parsed = Number.parseInt(value.slice(2), 16);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function decodeTokenLaunchedLog(log: RpcLog): LiveLaunch | null {
  if (!log || typeof log.address !== "string" || typeof log.blockNumber !== "string" ||
      typeof log.transactionHash !== "string" || typeof log.logIndex !== "string" ||
      typeof log.data !== "string" || !Array.isArray(log.topics) ||
      !log.topics.every((topic) => typeof topic === "string")) return null;
  if (log.address.toLowerCase() !== PONS_FACTORY) return null;
  if (log.topics.length !== 4 || log.topics[0]?.toLowerCase() !== TOKEN_LAUNCHED_TOPIC) return null;
  if (!/^0x[0-9a-fA-F]{192}$/.test(log.data)) return null;
  const token = addressFromTopic(log.topics[1] ?? "");
  const curve = addressFromTopic(log.topics[2] ?? "");
  const deployer = addressFromTopic(log.topics[3] ?? "");
  const words = log.data.slice(2).match(/.{64}/g);
  if (!token || !curve || !deployer || !words || words.length !== 3) return null;
  const pairToken = addressFromWord(words[0] ?? "");
  const blockNumber = parseHexInteger(log.blockNumber);
  const logIndex = parseHexInteger(log.logIndex);
  if (!pairToken || blockNumber === null || logIndex === null || !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash)) return null;
  return {
    token,
    curve,
    deployer,
    pairToken,
    launchConfigId: BigInt(`0x${words[1]}`).toString(),
    graduationThreshold: BigInt(`0x${words[2]}`).toString(),
    blockNumber,
    transactionHash: log.transactionHash.toLowerCase(),
    logIndex
  };
}

export type RpcCaller = (method: string, params?: unknown[]) => Promise<unknown>;

export interface LiveLaunchDecision extends LiveLaunch {
  verdict: "WATCH" | "VETO";
  pairLabel: "ETH" | "OTHER";
  market: PonsMarketState;
  assessment: PonsAssessment;
  handoffs: AgentHandoff[];
}

export interface LiveSnapshot {
  chainId: typeof ROBINHOOD_CHAIN_ID;
  headBlock: number;
  fetchedAt: string;
  source: "Robinhood Chain RPC";
  mode: "read-only";
  launches: LiveLaunchDecision[];
}

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function liveHandoffs(launch: LiveLaunch, market: PonsMarketState, assessment: PonsAssessment): AgentHandoff[] {
  const isEthPair = launch.pairToken === ZERO_ADDRESS;
  const verified = market.status === "VERIFIED";
  const entries: Array<[AgentOutcome, string]> = [
    ["INFO", `Detected Pons v2 launch in block ${launch.blockNumber}.`],
    ["INFO", "Policy locked: observe verified factory events; never sign or execute."],
    [verified ? "PASS" : "VETO", verified
      ? `Curve state verified: ${market.progressBps / 100}% to graduation; current snipe tax ${market.currentSnipeTaxBps / 100}%.`
      : `Market state unavailable: ${market.reason}`],
    ["INFO", "Social evidence not claimed by this read-only feed."],
    [verified ? "PASS" : "VETO", verified
      ? "Factory record and curve state verified against the launch event."
      : "Factory record and curve state could not be verified."],
    [verified ? "INFO" : "VETO", isEthPair
      ? verified
        ? `Native ETH pair and reserves verified at ${(market.progressBps / 100).toFixed(2)}% curve progress, but executable quote and slippage evidence are not available yet.`
        : "Native ETH pair found, but liquidity and slippage evidence are unavailable."
      : "Non-ETH pair is outside the default policy."],
    ["INFO", verified
      ? `Brief: on-chain evidence verified; creator tax ${market.creatorTaxBps / 100}%; social and slippage checks remain unresolved.`
      : "Brief: launch provenance verified; market, slippage, and social checks remain unresolved."],
    ["INFO", `Explorer-linked trace ${launch.transactionHash.slice(2, 18)} prepared.`],
    [assessment.verdict === "WATCH" ? "PASS" : "VETO", assessment.verdict === "WATCH"
      ? `Watch gate cleared at ${assessment.score}/100; unresolved evidence remains visible.`
      : `Veto: ${assessment.blockers.join("; ")}.`],
    [assessment.verdict === "WATCH" ? "PASS" : "VETO", assessment.verdict === "WATCH"
      ? "WATCH approved for read-only monitoring; no order was sent."
      : "No action approved; no order was sent."]
  ];
  const timestamp = new Date().toISOString();
  return entries.map(([outcome, message], index): AgentHandoff => ({
    sequence: index + 1,
    timestamp,
    agent: AGENTS[index]?.name ?? "PROFESSOR",
    role: AGENTS[index]?.role ?? "",
    outcome,
    message
  }));
}

function isRpcLog(value: unknown): value is RpcLog {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const log = value as Record<string, unknown>;
  return typeof log.address === "string" && typeof log.blockNumber === "string" &&
    typeof log.transactionHash === "string" && typeof log.logIndex === "string" &&
    Array.isArray(log.topics) && log.topics.every((topic) => typeof topic === "string") &&
    typeof log.data === "string";
}

export async function fetchLiveSnapshot(rpc: RpcCaller, options: { blockWindow?: number } = {}): Promise<LiveSnapshot> {
  const chainHex = await rpc("eth_chainId");
  if (typeof chainHex !== "string" || parseHexInteger(chainHex) !== ROBINHOOD_CHAIN_ID) {
    throw new Error("RPC is not Robinhood Chain mainnet (chain id 4663)");
  }
  const headHex = await rpc("eth_blockNumber");
  if (typeof headHex !== "string") throw new Error("RPC returned an invalid head block");
  const headBlock = parseHexInteger(headHex);
  if (headBlock === null) throw new Error("RPC returned an invalid head block");
  const requestedWindow = options.blockWindow ?? 1_500;
  if (!Number.isSafeInteger(requestedWindow) || requestedWindow < 1 || requestedWindow > 25_000) {
    throw new Error("blockWindow must be an integer from 1 to 25000");
  }
  const fromBlock = Math.max(0, headBlock - requestedWindow + 1);
  const rawLogs = await rpc("eth_getLogs", [{
    address: PONS_FACTORY,
    topics: [TOKEN_LAUNCHED_TOPIC],
    fromBlock: `0x${fromBlock.toString(16)}`,
    toBlock: headHex
  }]);
  if (!Array.isArray(rawLogs)) throw new Error("RPC returned invalid launch logs");
  const decodedLaunches = rawLogs.filter(isRpcLog).map(decodeTokenLaunchedLog).filter((launch): launch is LiveLaunch => launch !== null)
    .sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex)
    .slice(0, 24);
  const markets = await readPonsMarketStates(rpc, decodedLaunches, headHex);
  const launches = decodedLaunches.map((launch, index): LiveLaunchDecision => {
    const market = markets[index] ?? { status: "UNAVAILABLE", reason: "market evidence missing" };
    const pairLabel = launch.pairToken === ZERO_ADDRESS ? "ETH" : "OTHER";
    const assessment = assessPonsLaunch(pairLabel, market);
    return { ...launch, pairLabel, market, assessment, verdict: assessment.verdict, handoffs: liveHandoffs(launch, market, assessment) };
  });
  return {
    chainId: ROBINHOOD_CHAIN_ID,
    headBlock,
    fetchedAt: new Date().toISOString(),
    source: "Robinhood Chain RPC",
    mode: "read-only",
    launches
  };
}
