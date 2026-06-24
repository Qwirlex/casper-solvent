// Standalone check of the live on-chain write path. Calls submitRebalance directly
// so the casper-js-sdk integration is verified without the Gemini brain or the
// x402 service agents. Produces a real set_allocation transaction on casper-test.
import { submitRebalance } from "../src/fundAgent/chain.js";

async function main() {
  const alloc = { conservative: 60, growth: 40 };
  const ref = `live-check-${new Date().toISOString()}`;
  console.log("submitting set_allocation", alloc, "ref:", ref);
  const hash = await submitRebalance(alloc, ref);
  console.log("REBALANCE_TX_HASH:", hash);
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
