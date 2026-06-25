import { config } from "../shared/config.js";
import { payAndGet, loadClientSigner, type ClientSigner } from "./x402Client.js";
import { decideAllocation } from "./decision.js";
import { explainDecision } from "./llm.js";
import { readVaultState, submitRebalance, payService, accrueYield } from "./chain.js";
import type { Feed, RiskScore, Allocation } from "../shared/types.js";

export interface X402Payment {
  label: string;
  amount: string;
  txHash: string;
  payer?: string;
  payTo?: string;
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
  yieldAccrued: string;
  accrueTxHash: string;
}

// Load the x402 client signer once. The fund agent signs every payment authorization
// with this key, the same funded account that owns the vault.
let signerPromise: Promise<ClientSigner> | null = null;
function getSigner(): Promise<ClientSigner> {
  return (signerPromise = signerPromise ?? loadClientSigner(config.agentSecretKey));
}

// One decision cycle. Read state, buy a feed and a risk score over a real x402
// handshake, decide a bounded allocation, narrate it with Gemini, then submit the
// rebalance on chain. Each paid call signs an EIP-712 authorization and settles a
// CEP-18 transfer, the spend side of the agent economy.
export async function runCycle(log: (m: string) => void = console.log): Promise<CycleRecord> {
  const before = await readVaultState();
  log(
    `vault assets ${before.totalAssets}, allocation ${before.allocation.conservative}/${before.allocation.growth}`,
  );

  const signer = await getSigner();

  const feedPaid = await payAndGet<Feed>(`${config.dataAgentUrl}/feed`, {
    signer,
    settle: (req) => payService(config.dataAgentAccount, req.amount, 1),
  });
  const feed = feedPaid.data;
  const dataTx = feedPaid.payment?.settlement ?? "unsettled";
  log(`x402 paid data-agent, feed price ${feed.price}, settled CEP-18 ${dataTx}`);

  const riskPaid = await payAndGet<RiskScore>(
    `${config.riskAgentUrl}/risk?changePct24h=${feed.changePct24h}&price=${feed.price}`,
    { signer, settle: (req) => payService(config.riskAgentAccount, req.amount, 2) },
  );
  const risk = riskPaid.data;
  const riskTx = riskPaid.payment?.settlement ?? "unsettled";
  log(`x402 paid risk-agent, score ${risk.score}, settled CEP-18 ${riskTx}`);

  const decision = decideAllocation(risk);
  const reason = await explainDecision(feed, risk, decision.allocation);
  log(`decision ${decision.decisionRef}: ${reason}`);

  const rebalanceTxHash = await submitRebalance(decision.allocation, decision.decisionRef);
  log(`submitted rebalance ${rebalanceTxHash}`);

  // Accrue yield into the vault, about 0.5 percent of assets per cycle, funded from
  // the agent reserve. This raises assets per share on chain, the depositors earn.
  const yieldAccrued = (before.totalAssets / 200n).toString();
  const accrueTxHash = await accrueYield(yieldAccrued);
  log(`accrued yield ${yieldAccrued}, tx ${accrueTxHash}`);

  const feeHarvested = (before.totalAssets / 2000n).toString(); // 0.05 percent agent fee
  const price = config.x402Price;

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
      {
        label: "data-agent feed",
        amount: feedPaid.payment?.value ?? price,
        txHash: dataTx,
        payer: feedPaid.payment?.payer,
        payTo: feedPaid.payment?.payTo,
      },
      {
        label: "risk-agent score",
        amount: riskPaid.payment?.value ?? price,
        txHash: riskTx,
        payer: riskPaid.payment?.payer,
        payTo: riskPaid.payment?.payTo,
      },
    ],
    feeHarvested,
    rebalanceTxHash,
    yieldAccrued,
    accrueTxHash,
  };
}
