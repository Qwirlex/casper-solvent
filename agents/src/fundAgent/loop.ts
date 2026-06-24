import { config } from "../shared/config.js";
import { payAndGet } from "./x402Client.js";
import { decideAllocation } from "./decision.js";
import { explainDecision } from "./llm.js";
import { readVaultState, submitRebalance } from "./chain.js";
import type { Feed, RiskScore, Allocation } from "../shared/types.js";

export interface X402Payment {
  label: string;
  amount: string;
  txHash: string;
}

export interface CycleRecord {
  ts: number;
  vaultAssets: string;
  allocationBefore: Allocation;
  feedPrice: number;
  riskScore: number;
  allocationAfter: Allocation;
  decisionRef: string;
  reason: string;
  x402Payments: X402Payment[];
  feeHarvested: string;
  rebalanceTxHash: string;
}

// Price the agent pays per service call, 1 sUSD at 9 decimals.
const X402_PRICE = "1000000000";

function pseudoTx(label: string, salt: number): string {
  let h = salt >>> 0;
  for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `local-${h.toString(16).padStart(8, "0")}`;
}

// One decision cycle. Read state, buy a feed and a risk score over x402, decide a
// bounded allocation, narrate it with Gemini, then submit the rebalance on chain.
export async function runCycle(log: (m: string) => void = console.log): Promise<CycleRecord> {
  const before = await readVaultState();
  log(
    `vault assets ${before.totalAssets}, allocation ${before.allocation.conservative}/${before.allocation.growth}`,
  );

  const feed = await payAndGet<Feed>(`${config.dataAgentUrl}/feed`);
  log(`paid data-agent over x402, price ${feed.price}`);

  const risk = await payAndGet<RiskScore>(
    `${config.riskAgentUrl}/risk?changePct24h=${feed.changePct24h}&price=${feed.price}`,
  );
  log(`paid risk-agent over x402, score ${risk.score}`);

  const decision = decideAllocation(risk);
  const reason = await explainDecision(feed, risk, decision.allocation);
  log(`decision ${decision.decisionRef}: ${reason}`);

  const rebalanceTxHash = await submitRebalance(decision.allocation, decision.decisionRef);
  log(`submitted rebalance ${rebalanceTxHash}`);

  const feeHarvested = (before.totalAssets / 200n).toString(); // 0.5 percent illustrative skim

  return {
    ts: Date.now(),
    vaultAssets: before.totalAssets.toString(),
    allocationBefore: before.allocation,
    feedPrice: feed.price,
    riskScore: risk.score,
    allocationAfter: decision.allocation,
    decisionRef: decision.decisionRef,
    reason,
    x402Payments: [
      { label: "data-agent feed", amount: X402_PRICE, txHash: pseudoTx("data", risk.score) },
      { label: "risk-agent score", amount: X402_PRICE, txHash: pseudoTx("risk", risk.score) },
    ],
    feeHarvested,
    rebalanceTxHash,
  };
}
