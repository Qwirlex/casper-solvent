import { config } from "../src/shared/config.js";

// Seeds the v2 yield vault on chain so the dApp shows a real position with real
// profit. As the funded account it approves the vault, deposits principal, then
// approves again and accrues yield from the same account standing in for the
// emissions reserve. Every step is a real transaction. Amounts in atomic units,
// 9 decimals, override with DEPOSIT and YIELD.
const DEPOSIT = process.env.DEPOSIT ?? "100000000000"; // 100 sUSD
const YIELD = process.env.YIELD ?? "8000000000"; // 8 sUSD, an 8 percent bump

async function main(): Promise<void> {
  const sdk: any = await import("casper-js-sdk");
  const { HttpHandler, RpcClient, Args, CLValue, Key, ContractCallBuilder, PrivateKey, KeyAlgorithm } = sdk;
  const rpc = new RpcClient(new HttpHandler(config.node));
  const pem = await (await import("node:fs/promises")).readFile(config.agentSecretKey, "utf8");
  const priv = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);

  const payPkg = config.payTokenHash.replace(/^hash-/, "");
  const vaultPkg = config.vaultHash.replace(/^hash-/, "");
  const vaultKey = Key.newKey(`hash-${vaultPkg}`);

  async function submit(label: string, build: () => any): Promise<string> {
    const tx = build();
    tx.sign(priv);
    const res = await rpc.putTransaction(tx);
    const h = res.transactionHash;
    const hash = h?.transactionV1?.toHex?.() ?? h?.deploy?.toHex?.() ?? h?.toHex?.() ?? String(h);
    console.log(`${label} submitted ${hash}`);
    await waitTx(hash, label);
    return hash;
  }

  async function waitTx(hash: string, label: string): Promise<void> {
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      for (const path of [`deploys/${hash}`, `transactions/${hash}`]) {
        try {
          const r = await fetch(`https://api.testnet.cspr.cloud/${path}`, {
            headers: { authorization: config.csprCloudKey },
          });
          if (r.ok) {
            const d: any = await r.json();
            const data = d.data ?? d;
            if (data && data.error_message !== undefined) {
              if (data.error_message) throw new Error(`${label} reverted: ${data.error_message}`);
              console.log(`${label} confirmed, block ${data.block_height}`);
              return;
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message.includes("reverted")) throw e;
        }
      }
      await new Promise((r) => setTimeout(r, 6000));
    }
    throw new Error(`${label} not confirmed in time`);
  }

  const approve = (amount: string) =>
    new ContractCallBuilder()
      .byPackageHash(payPkg)
      .entryPoint("approve")
      .runtimeArgs(Args.fromMap({ spender: CLValue.newCLKey(vaultKey), amount: CLValue.newCLUInt256(amount) }))
      .payment(5_000_000_000)
      .chainName(config.chain)
      .from(priv.publicKey)
      .buildFor1_5();

  const vaultCall = (entry: string, amount: string) =>
    new ContractCallBuilder()
      .byPackageHash(vaultPkg)
      .entryPoint(entry)
      .runtimeArgs(Args.fromMap({ amount: CLValue.newCLUInt256(amount) }))
      .payment(5_000_000_000)
      .chainName(config.chain)
      .from(priv.publicKey)
      .buildFor1_5();

  console.log(`seeding vault ${vaultPkg} with token ${payPkg}`);
  await submit("approve for deposit", () => approve(DEPOSIT));
  await submit("deposit", () => vaultCall("deposit", DEPOSIT));
  await submit("approve for accrue", () => approve(YIELD));
  await submit("accrue", () => vaultCall("accrue", YIELD));
  console.log("seed complete");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
