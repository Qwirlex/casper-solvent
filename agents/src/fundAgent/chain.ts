import { config } from "../shared/config.js";
import type { Allocation } from "../shared/types.js";

// Chain glue. Two modes.
//
// Local mode, the default, lets the whole loop and the dashboard run without a
// funded testnet. The vault state lives in a small in memory store, submitRebalance
// returns a deterministic pseudo hash. This proves the agent logic end to end.
//
// Live mode, set CASPER_LIVE=1, reads the deployed vault through the CSPR.cloud REST
// API and submits a real set_allocation transaction with casper-js-sdk. The live
// write path is verified at the funded deploy stage, when the vault hash and a funded
// agent key exist.
const LIVE = process.env.CASPER_LIVE === "1";

interface VaultState {
  totalAssets: bigint;
  allocation: Allocation;
}

// Local mock state, seeded with a deposit so the demo shows a funded vault.
const localState: VaultState = {
  totalAssets: 10_000_000_000n, // 10 sUSD at 9 decimals
  allocation: { conservative: 100, growth: 0 },
};

export async function readVaultState(): Promise<VaultState> {
  if (!LIVE) return { ...localState, allocation: { ...localState.allocation } };

  // Live read through CSPR.cloud REST. The vault stores total_assets and the
  // allocation as contract state, CSPR.cloud exposes it by contract hash. The read
  // is best effort, a failure here must never break a decision cycle, the loop
  // still buys data and risk, decides, and writes the rebalance on chain. We fall
  // back to the conservative default the vault is initialised with.
  const fallback: VaultState = {
    totalAssets: localState.totalAssets,
    allocation: { conservative: 100, growth: 0 },
  };
  try {
    const hash = config.vaultHash.replace(/^hash-/, "");
    const url = `https://api.testnet.cspr.cloud/contracts/${hash}/named-keys`;
    const res = await fetch(url, { headers: { authorization: config.csprCloudKey } });
    if (!res.ok) return fallback;
    const body: any = await res.json();
    const keys: Record<string, any> = {};
    for (const item of body.data ?? []) keys[item.name] = item.value ?? item;
    const conservative = Number(keys["alloc_conservative"] ?? fallback.allocation.conservative);
    const growth = Number(keys["alloc_growth"] ?? fallback.allocation.growth);
    const totalAssets = BigInt(keys["total_assets"] ?? fallback.totalAssets);
    return { totalAssets, allocation: { conservative, growth } };
  } catch {
    return fallback;
  }
}

// Settle one service payment. Live mode sends a real CEP-18 transfer of the fee from
// the agent to the service agent account on chain, the spend side of the loop. Local
// mode returns a stable pseudo hash so the loop and dashboard run with no funded chain.
export async function payService(
  recipientAccountHash: string,
  amount: string,
  salt: number,
): Promise<string> {
  if (!LIVE || !recipientAccountHash) {
    let h = salt >>> 0;
    for (const ch of recipientAccountHash + amount) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `local-${h.toString(16).padStart(8, "0")}`;
  }
  const sdk: any = await import("casper-js-sdk");
  const { HttpHandler, RpcClient, Args, CLValue, Key, ContractCallBuilder, PrivateKey, KeyAlgorithm } =
    sdk;
  const rpc = new RpcClient(new HttpHandler(config.node));
  const pem = await (await import("node:fs/promises")).readFile(config.agentSecretKey, "utf8");
  const priv = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);
  const tokenPkg = config.payTokenHash.replace(/^hash-/, "");
  const tx = new ContractCallBuilder()
    .byPackageHash(tokenPkg)
    .entryPoint("transfer")
    .runtimeArgs(
      Args.fromMap({
        recipient: CLValue.newCLKey(Key.newKey(recipientAccountHash)),
        amount: CLValue.newCLUInt256(amount),
      }),
    )
    .payment(5_000_000_000)
    .chainName(config.chain)
    .from(priv.publicKey)
    .buildFor1_5();
  tx.sign(priv);
  const result = await rpc.putTransaction(tx);
  const h = result.transactionHash;
  return h?.transactionV1?.toHex?.() ?? h?.deploy?.toHex?.() ?? h?.toHex?.() ?? String(h);
}

export async function submitRebalance(
  alloc: Allocation,
  decisionRef: string,
): Promise<string> {
  if (!LIVE) {
    // Reflect the decision in the local store and return a stable pseudo hash.
    localState.allocation = { ...alloc };
    const seed = `${alloc.conservative}-${alloc.growth}-${decisionRef}`;
    let h = 0;
    for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `local-${h.toString(16).padStart(8, "0")}`;
  }

  // Live submit with casper-js-sdk 5.x. The vault is an Odra contract installed on
  // the vm-casper-v1 engine, so we target it by package hash and build a 1.5/legacy
  // deploy transaction, the runtime that can reach a v1 contract package.
  const sdk: any = await import("casper-js-sdk");
  const { HttpHandler, RpcClient, Args, CLValue, ContractCallBuilder, PrivateKey, KeyAlgorithm } =
    sdk;
  const rpc = new RpcClient(new HttpHandler(config.node));
  const pem = await (await import("node:fs/promises")).readFile(config.agentSecretKey, "utf8");
  const priv = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);
  const packageHash = config.vaultHash.replace(/^hash-/, "");
  const tx = new ContractCallBuilder()
    .byPackageHash(packageHash)
    .entryPoint("set_allocation")
    .runtimeArgs(
      Args.fromMap({
        conservative: CLValue.newCLUint8(alloc.conservative),
        growth: CLValue.newCLUint8(alloc.growth),
        decision_ref: CLValue.newCLString(decisionRef),
      }),
    )
    .payment(5_000_000_000)
    .chainName(config.chain)
    .from(priv.publicKey)
    .buildFor1_5();
  tx.sign(priv);
  const result = await rpc.putTransaction(tx);
  const h = result.transactionHash;
  return (
    h?.transactionV1?.toHex?.() ??
    h?.deploy?.toHex?.() ??
    h?.toHex?.() ??
    String(h)
  );
}

// Accrue yield into the vault, the income side for depositors. The agent holds a
// reserve of pay token and a standing allowance to the vault, so this calls accrue
// directly and the vault pulls the amount in, raising assets per share. Live mode only,
// local mode returns a pseudo hash.
export async function accrueYield(amount: string): Promise<string> {
  if (!LIVE) return `local-accrue-${amount}`;
  const sdk: any = await import("casper-js-sdk");
  const { HttpHandler, RpcClient, Args, CLValue, ContractCallBuilder, PrivateKey, KeyAlgorithm } = sdk;
  const rpc = new RpcClient(new HttpHandler(config.node));
  const pem = await (await import("node:fs/promises")).readFile(config.agentSecretKey, "utf8");
  const priv = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);
  const packageHash = config.vaultHash.replace(/^hash-/, "");
  const tx = new ContractCallBuilder()
    .byPackageHash(packageHash)
    .entryPoint("accrue")
    .runtimeArgs(Args.fromMap({ amount: CLValue.newCLUInt256(amount) }))
    .payment(5_000_000_000)
    .chainName(config.chain)
    .from(priv.publicKey)
    .buildFor1_5();
  tx.sign(priv);
  const result = await rpc.putTransaction(tx);
  const h = result.transactionHash;
  return h?.transactionV1?.toHex?.() ?? h?.deploy?.toHex?.() ?? h?.toHex?.() ?? String(h);
}
