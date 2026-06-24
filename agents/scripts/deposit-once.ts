// One real deposit into the vault on casper-test, so the on-chain vault holds a
// depositor position the agent then manages. Mirrors the live rebalance write path.
import { readFile } from "node:fs/promises";
import { config } from "../src/shared/config.js";

async function main() {
  const amount = process.argv[2] ?? "10000000000"; // 10 sUSD at 9 decimals
  const sdk: any = await import("casper-js-sdk");
  const { HttpHandler, RpcClient, Args, CLValue, ContractCallBuilder, PrivateKey, KeyAlgorithm } =
    sdk;
  const rpc = new RpcClient(new HttpHandler(config.node));
  const pem = await readFile(config.agentSecretKey, "utf8");
  const priv = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);
  const packageHash = config.vaultHash.replace(/^hash-/, "");
  const tx = new ContractCallBuilder()
    .byPackageHash(packageHash)
    .entryPoint("deposit")
    .runtimeArgs(Args.fromMap({ amount: CLValue.newCLUInt256(amount) }))
    .payment(5_000_000_000)
    .chainName(config.chain)
    .from(priv.publicKey)
    .buildFor1_5();
  tx.sign(priv);
  const result = await rpc.putTransaction(tx);
  const h = result.transactionHash;
  console.log(
    "DEPOSIT_TX_HASH:",
    h?.transactionV1?.toHex?.() ?? h?.deploy?.toHex?.() ?? h?.toHex?.() ?? String(h),
  );
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
