import { decodeFunctionResult, encodeFunctionData, parseAbi, type Hex } from "viem";
import type { LiveLaunch, RpcCaller } from "./live.js";

export const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";

const MULTICALL_ABI = parseAbi([
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)"
]);
const TOKEN_METADATA_ABI = parseAbi([
  "struct Socials { string twitter; string telegram; string discord; string website; string farcaster; }",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function getTokenInfo() view returns (address tokenDeployer, string tokenLogo, string tokenDescription, Socials tokenSocials)"
]);

export interface DeclaredPonsTokenMetadata {
  status: "DECLARED";
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: { twitter: string; telegram: string; discord: string; website: string; farcaster: string };
}

export interface UnavailablePonsTokenMetadata { status: "UNAVAILABLE"; reason: string }
export type PonsTokenMetadata = DeclaredPonsTokenMetadata | UnavailablePonsTokenMetadata;

function safeText(value: unknown, maximum: number): string | null {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximum) : null;
}

export function decodePonsTokenMetadata(nameRaw: unknown, symbolRaw: unknown, infoRaw: unknown): PonsTokenMetadata {
  try {
    if (typeof nameRaw !== "string" || typeof symbolRaw !== "string" || typeof infoRaw !== "string") throw new Error();
    const name = safeText(decodeFunctionResult({ abi: TOKEN_METADATA_ABI, functionName: "name", data: nameRaw as Hex }), 120);
    const symbol = safeText(decodeFunctionResult({ abi: TOKEN_METADATA_ABI, functionName: "symbol", data: symbolRaw as Hex }), 32);
    const info = decodeFunctionResult({ abi: TOKEN_METADATA_ABI, functionName: "getTokenInfo", data: infoRaw as Hex });
    const logo = safeText(info[1], 500), description = safeText(info[2], 500), declared = info[3];
    const twitter = safeText(declared.twitter, 500), telegram = safeText(declared.telegram, 500);
    const discord = safeText(declared.discord, 500), website = safeText(declared.website, 500), farcaster = safeText(declared.farcaster, 500);
    if (name === null || symbol === null || logo === null || description === null || twitter === null || telegram === null ||
        discord === null || website === null || farcaster === null) throw new Error();
    return { status: "DECLARED", name, symbol, logo, description, socials: { twitter, telegram, discord, website, farcaster } };
  } catch {
    return { status: "UNAVAILABLE", reason: "token metadata unreadable" };
  }
}

export const PONS_SELECTORS = {
  getLaunchedToken: "0x3cf28b5a",
  getReserves: "0x0902f1ac",
  realQuoteReserve: "0x4f1f58fd",
  currentSnipeTaxBps: "0xd7e1ef39"
} as const;

export const MARKET_PROBE_RECIPIENT = "0x000000000000000000000000000000000000dead";

export interface PonsMarketReads {
  factoryRecord: unknown;
  reserves: unknown;
  realQuoteReserve: unknown;
  currentSnipeTaxBps: unknown;
}

export interface VerifiedPonsMarketState {
  status: "VERIFIED";
  creatorFeeRecipient: string;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  phase: "CURVE" | "SWEPT" | "POOL" | "RESCUED";
  quoteReserve: string;
  tokenReserve: string;
  realQuoteReserve: string;
  graduationThreshold: string;
  progressBps: number;
  currentSnipeTaxBps: number;
}

export interface RejectedPonsMarketState {
  status: "REJECTED";
  reason: string;
}

export interface UnavailablePonsMarketState {
  status: "UNAVAILABLE";
  reason: string;
}

export type PonsMarketState = VerifiedPonsMarketState | RejectedPonsMarketState | UnavailablePonsMarketState;

export interface PonsAssessment {
  verdict: "WATCH" | "VETO";
  score: number;
  reasons: string[];
  blockers: string[];
  unknowns: string[];
}

const ADDRESS_WORD = /^0{24}[0-9a-fA-F]{40}$/;
const HEX_WORDS = /^0x(?:[0-9a-fA-F]{64})+$/;
const PHASES = ["CURVE", "SWEPT", "POOL", "RESCUED"] as const;

function words(value: unknown, expected: number): string[] | null {
  if (typeof value !== "string" || !HEX_WORDS.test(value) || value.length !== 2 + expected * 64) return null;
  return value.slice(2).match(/.{64}/g);
}

function address(word: string | undefined): string | null {
  return word && ADDRESS_WORD.test(word) ? `0x${word.slice(24)}`.toLowerCase() : null;
}

function uint(word: string | undefined, bits = 256): bigint | null {
  if (!word || !/^[0-9a-fA-F]{64}$/.test(word)) return null;
  const value = BigInt(`0x${word}`);
  return value < (1n << BigInt(bits)) ? value : null;
}

function bool(word: string | undefined): boolean | null {
  const value = uint(word, 8);
  return value === 0n ? false : value === 1n ? true : null;
}

function reject(reason: string): RejectedPonsMarketState {
  return { status: "REJECTED", reason };
}

export function assessPonsLaunch(pairLabel: "ETH" | "OTHER", market: PonsMarketState): PonsAssessment {
  const unknowns = ["Executable slippage and social quality are not measured"];
  if (market.status !== "VERIFIED") {
    const prefix = market.status === "REJECTED" ? "Market evidence rejected" : "Market evidence unavailable";
    return { verdict: "VETO", score: 0, reasons: [], blockers: [`${prefix}: ${market.reason}`], unknowns };
  }

  let score = 25;
  const reasons = ["Verified factory provenance (+25)"];
  const blockers: string[] = [];

  if (pairLabel === "ETH") {
    score += 15;
    reasons.push("Native ETH pair (+15)");
  } else {
    blockers.push("Unsupported pair token");
  }

  if (market.phase === "CURVE" || market.phase === "POOL") {
    score += 10;
    reasons.push(`Active ${market.phase.toLowerCase()} phase (+10)`);
  } else {
    blockers.push(`Non-active ${market.phase.toLowerCase()} phase`);
  }

  if (BigInt(market.quoteReserve) > 0n && BigInt(market.tokenReserve) > 0n) {
    score += 5;
    reasons.push("Positive on-chain reserves (+5)");
  }

  if (market.creatorTaxBps <= 200) {
    score += 10;
    reasons.push("Creator tax at or below 2% (+10)");
  } else if (market.creatorTaxBps <= 500) {
    score += 5;
    reasons.push("Creator tax at or below 5% (+5)");
  } else {
    blockers.push(`Creator tax above 5% (${(market.creatorTaxBps / 100).toFixed(2)}%)`);
  }

  if (market.currentSnipeTaxBps <= 200) {
    score += 10;
    reasons.push("Current snipe tax at or below 2% (+10)");
  } else if (market.currentSnipeTaxBps <= 500) {
    score += 5;
    reasons.push("Current snipe tax at or below 5% (+5)");
  } else {
    blockers.push(`Current snipe tax above 5% (${(market.currentSnipeTaxBps / 100).toFixed(2)}%)`);
  }

  const progressPoints = market.progressBps >= 2500 ? 25 : market.progressBps >= 1000 ? 20 :
    market.progressBps >= 250 ? 10 : market.progressBps > 0 ? 5 : 0;
  score += progressPoints;
  reasons.push(`${(market.progressBps / 100).toFixed(2)}% curve progress (+${progressPoints})`);

  return {
    verdict: blockers.length === 0 && score >= 70 ? "WATCH" : "VETO",
    score,
    reasons,
    blockers: blockers.length > 0 ? blockers : score >= 70 ? [] : [`Score below watch threshold (${score}/70)`],
    unknowns
  };
}

export function encodeAddressArgument(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("invalid address argument");
  return value.slice(2).toLowerCase().padStart(64, "0");
}

export function decodePonsMarketState(launch: LiveLaunch, reads: PonsMarketReads): PonsMarketState {
  const record = words(reads.factoryRecord, 15);
  const reserves = words(reads.reserves, 2);
  const real = words(reads.realQuoteReserve, 1);
  const opening = words(reads.currentSnipeTaxBps, 1);
  if (!record || !reserves || !real || !opening) return reject("malformed Pons market response");

  const token = address(record[0]);
  const curve = address(record[1]);
  const deployer = address(record[2]);
  const creatorFeeRecipient = address(record[3]);
  const pairToken = address(record[4]);
  const graduationThreshold = uint(record[5]);
  const creatorTaxBps = uint(record[8], 16);
  const buybackEnabled = bool(record[9]);
  const phaseNumber = uint(record[10], 8);
  const exists = bool(record[14]);
  const quoteReserve = uint(reserves[0]);
  const tokenReserve = uint(reserves[1]);
  const realQuoteReserve = uint(real[0]);
  const currentSnipeTaxBps = uint(opening[0]);

  if (!token || !curve || !deployer || !creatorFeeRecipient || !pairToken || graduationThreshold === null ||
      creatorTaxBps === null || buybackEnabled === null || phaseNumber === null || exists === null ||
      quoteReserve === null || tokenReserve === null || realQuoteReserve === null || currentSnipeTaxBps === null) {
    return reject("invalid Pons market values");
  }
  if (!exists || token !== launch.token || curve !== launch.curve || deployer !== launch.deployer ||
      pairToken !== launch.pairToken || graduationThreshold.toString() !== launch.graduationThreshold) {
    return reject("factory record contradicts launch event");
  }
  const phase = PHASES[Number(phaseNumber)];
  if (!phase || creatorTaxBps > 10_000n || currentSnipeTaxBps > 10_000n || quoteReserve === 0n || tokenReserve === 0n) {
    return reject("Pons market values are outside protocol bounds");
  }
  const progress = graduationThreshold === 0n ? 0n : (realQuoteReserve * 10_000n) / graduationThreshold;
  return {
    status: "VERIFIED",
    creatorFeeRecipient,
    creatorTaxBps: Number(creatorTaxBps),
    buybackEnabled,
    phase,
    quoteReserve: quoteReserve.toString(),
    tokenReserve: tokenReserve.toString(),
    realQuoteReserve: realQuoteReserve.toString(),
    graduationThreshold: graduationThreshold.toString(),
    progressBps: Number(progress > 10_000n ? 10_000n : progress),
    currentSnipeTaxBps: Number(currentSnipeTaxBps)
  };
}

export interface PonsLaunchResearch {
  market: PonsMarketState;
  metadata: PonsTokenMetadata;
}

export async function readPonsLaunchResearch(
  rpc: RpcCaller,
  launches: LiveLaunch[],
  blockTag: string
): Promise<PonsLaunchResearch[]> {
  if (launches.length === 0) return [];
  const calls = launches.flatMap((launch) => [
    {
      target: "0x7ed598bcef8bd9edd8c97a195c6d13f40801ec7e" as const,
      allowFailure: true,
      callData: `${PONS_SELECTORS.getLaunchedToken}${encodeAddressArgument(launch.token)}` as Hex
    },
    { target: launch.curve as `0x${string}`, allowFailure: true, callData: PONS_SELECTORS.getReserves },
    { target: launch.curve as `0x${string}`, allowFailure: true, callData: PONS_SELECTORS.realQuoteReserve },
    {
      target: launch.curve as `0x${string}`,
      allowFailure: true,
      callData: `${PONS_SELECTORS.currentSnipeTaxBps}${encodeAddressArgument(MARKET_PROBE_RECIPIENT)}` as Hex
    },
    { target: launch.token as `0x${string}`, allowFailure: true, callData: encodeFunctionData({ abi: TOKEN_METADATA_ABI, functionName: "name" }) },
    { target: launch.token as `0x${string}`, allowFailure: true, callData: encodeFunctionData({ abi: TOKEN_METADATA_ABI, functionName: "symbol" }) },
    { target: launch.token as `0x${string}`, allowFailure: true, callData: encodeFunctionData({ abi: TOKEN_METADATA_ABI, functionName: "getTokenInfo" }) }
  ]);

  try {
    const data = encodeFunctionData({ abi: MULTICALL_ABI, functionName: "aggregate3", args: [calls] });
    const raw = await rpc("eth_call", [{ to: MULTICALL3, data }, blockTag]);
    if (typeof raw !== "string" || !/^0x[0-9a-fA-F]*$/.test(raw)) throw new Error("invalid multicall response");
    const results = decodeFunctionResult({ abi: MULTICALL_ABI, functionName: "aggregate3", data: raw as Hex });
    if (results.length !== calls.length) throw new Error("incomplete multicall response");

    return launches.map((launch, index) => {
      const group = results.slice(index * 7, index * 7 + 7);
      const market = group.length === 7 && group.slice(0, 4).every((result) => result.success)
        ? decodePonsMarketState(launch, {
          factoryRecord: group[0]?.returnData,
          reserves: group[1]?.returnData,
          realQuoteReserve: group[2]?.returnData,
          currentSnipeTaxBps: group[3]?.returnData
        })
        : { status: "UNAVAILABLE", reason: "one or more pinned Pons market reads failed" } as PonsMarketState;
      const metadata = group.length === 7 && group.slice(4).every((result) => result.success)
        ? decodePonsTokenMetadata(group[4]?.returnData, group[5]?.returnData, group[6]?.returnData)
        : { status: "UNAVAILABLE", reason: "token metadata unreadable" } as PonsTokenMetadata;
      return { market, metadata };
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "RPC read failed";
    return launches.map(() => ({
      market: { status: "UNAVAILABLE", reason: `market reads unavailable: ${message.slice(0, 120)}` },
      metadata: { status: "UNAVAILABLE", reason: "token metadata unavailable with market reads" }
    }));
  }
}

export async function readPonsMarketStates(rpc: RpcCaller, launches: LiveLaunch[], blockTag: string): Promise<PonsMarketState[]> {
  return (await readPonsLaunchResearch(rpc, launches, blockTag)).map((research) => research.market);
}
