import { readFileSync, existsSync } from "node:fs";
import { config } from "../shared/config.js";
import { accrueYield } from "../fundAgent/chain.js";
import { VaultReader, toAccountHash } from "../shared/vaultReader.js";

// Yield accrual worker. Every interval it credits each depositor with yield, at a rate
// that steps up with their principal tier. This is the income side running on its own,
// so a position earns over time without anyone pressing a button. Funded from the agent
// reserve through the standing allowance to the vault.

const DEPOSITORS_FILE = process.env.DEPOSITORS_FILE ?? "./depositors.json";
const INTERVAL_MS = Number(process.env.ACCRUE_INTERVAL_MS ?? 180000); // 3 minutes

function tierBps(depositedRaw: bigint): bigint {
  const susd = depositedRaw / 1_000_000_000n;
  if (susd < 100n) return 20n; // 0.20 percent per cycle
  if (susd < 1000n) return 40n; // 0.40 percent
  if (susd < 10000n) return 60n; // 0.60 percent
  return 80n; // 0.80 percent
}

function readDepositors(): string[] {
  try {
    if (!existsSync(DEPOSITORS_FILE)) return [];
    const a = JSON.parse(readFileSync(DEPOSITORS_FILE, "utf8"));
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

async function accrueAll(): Promise<void> {
  const reader = new VaultReader({ node: config.node, packageHash: config.vaultHash });
  const depositors = readDepositors();
  if (depositors.length === 0) {
    console.log("no depositors yet");
    return;
  }
  for (const d of depositors) {
    try {
      const dep = BigInt(await reader.depositedOf(d));
      if (dep === 0n) continue;
      const amount = (dep * tierBps(dep)) / 10000n;
      if (amount === 0n) continue;
      const tx = await accrueYield(toAccountHash(d), amount.toString());
      console.log(`accrued ${amount} to ${d.slice(0, 10)} at ${tierBps(dep)} bps, tx ${tx}`);
    } catch (e) {
      console.error(`accrue failed for ${d.slice(0, 10)}`, e instanceof Error ? e.message : e);
    }
  }
}

async function main(): Promise<void> {
  console.log(`accrual worker up, every ${INTERVAL_MS / 1000}s, vault ${config.vaultHash}`);
  for (;;) {
    try {
      await accrueAll();
    } catch (e) {
      console.error("accrual round failed", e);
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
