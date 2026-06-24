// Real on-chain settlement of the agent's service payments. The fund agent holds the
// pay token supply, here it pays the data agent and the risk agent one sUSD each with a
// real CEP-18 transfer on casper-test. This is the spend side of the economic loop, the
// agent paying its own way for the services it consumes. The x402 HTTP wrapper sits on
// top of this same transfer in the productionized path.
import { readFile } from "node:fs/promises";
import { config } from "../src/shared/config.js";

const RECIPIENTS = [
  { label: "data-agent", account: process.env.DATA_AGENT_ACCOUNT ?? "" },
  { label: "risk-agent", account: process.env.RISK_AGENT_ACCOUNT ?? "" },
];
const PRICE = "1000000000"; // 1 sUSD at 9 decimals

async function main() {
  const sdk: any = await import("casper-js-sdk");
  const { HttpHandler, RpcClient, Args, CLValue, Key, ContractCallBuilder, PrivateKey, KeyAlgorithm } =
    sdk;
  const rpc = new RpcClient(new HttpHandler(config.node));
  const pem = await readFile(config.agentSecretKey, "utf8");
  const priv = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);
  const tokenPkg = config.payTokenHash.replace(/^hash-/, "");

  for (const r of RECIPIENTS) {
    if (!r.account) throw new Error(`missing recipient account for ${r.label}`);
    const tx = new ContractCallBuilder()
      .byPackageHash(tokenPkg)
      .entryPoint("transfer")
      .runtimeArgs(
        Args.fromMap({
          recipient: CLValue.newCLKey(Key.newKey(r.account)),
          amount: CLValue.newCLUInt256(PRICE),
        }),
      )
      .payment(5_000_000_000)
      .chainName(config.chain)
      .from(priv.publicKey)
      .buildFor1_5();
    tx.sign(priv);
    const result = await rpc.putTransaction(tx);
    const h = result.transactionHash;
    const hash = h?.transactionV1?.toHex?.() ?? h?.deploy?.toHex?.() ?? h?.toHex?.() ?? String(h);
    console.log(`PAY ${r.label} -> ${r.account}  TX: ${hash}`);
  }
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
