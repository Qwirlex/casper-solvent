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
  // allocation as named keys, CSPR.cloud exposes contract state by hash.
  const url = `https://api.testnet.cspr.cloud/contracts/${config.vaultHash}/named-keys`;
  const res = await fetch(url, { headers: { authorization: config.csprCloudKey } });
  if (!res.ok) throw new Error(`cspr.cloud read failed ${res.status}`);
  const body: any = await res.json();
  // Parse the named keys into our shape. The exact field paths are confirmed once
  // the vault is deployed, the parser below is the funded stage integration point.
  const keys: Record<string, any> = {};
  for (const item of body.data ?? []) keys[item.name] = item.value ?? item;
  const conservative = Number(keys["alloc_conservative"] ?? 100);
  const growth = Number(keys["alloc_growth"] ?? 0);
  const totalAssets = BigInt(keys["total_assets"] ?? 0);
  return { totalAssets, allocation: { conservative, growth } };
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

  // Live submit with casper-js-sdk 5.x. Built here, verified at the funded stage.
  const sdk: any = await import("casper-js-sdk");
  const { HttpHandler, RpcClient, Args, CLValue, ContractCallBuilder, KeyPair } = sdk;
  const rpc = new RpcClient(new HttpHandler(config.node));
  const keyPair = KeyPair.fromPem(
    await (await import("node:fs/promises")).readFile(config.agentSecretKey, "utf8"),
  );
  const tx = new ContractCallBuilder()
    .byHash(config.vaultHash)
    .entryPoint("set_allocation")
    .runtimeArgs(
      Args.fromMap({
        conservative: CLValue.newCLUint8(alloc.conservative),
        growth: CLValue.newCLUint8(alloc.growth),
        decision_ref: CLValue.newCLString(decisionRef),
      }),
    )
    .payment(2_500_000_000)
    .chainName(config.chain)
    .from(keyPair.publicKey)
    .build();
  tx.sign(keyPair.privateKey);
  const result = await rpc.putTransaction(tx);
  return result.transactionHash?.toHex?.() ?? String(result.transactionHash);
}
