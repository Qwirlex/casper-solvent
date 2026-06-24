import { startDataAgent } from "../src/dataAgent/server.js";
import { startRiskAgent } from "../src/riskAgent/server.js";
import { runCycle } from "../src/fundAgent/loop.js";

// Local end to end. Starts the two service agents in process, runs one full decision
// cycle, prints the record, then shuts them down. No funded testnet needed, this
// proves the agent logic and the x402 call shape end to end.
async function main(): Promise<void> {
  const data = startDataAgent(4001);
  const risk = startRiskAgent(4002);
  await new Promise((r) => setTimeout(r, 500));
  try {
    console.log("=== Solvent local end to end ===");
    const rec = await runCycle();
    console.log(JSON.stringify(rec, null, 2));
  } finally {
    data.close();
    risk.close();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
