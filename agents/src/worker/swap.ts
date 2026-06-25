import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { config } from "../shared/config.js";

// Swap worker, the CSPR to sUSD exchange. The treasury account holds both. A user buys
// by sending native CSPR to the treasury, the worker sends back sUSD at the rate. A user
// sells by sending sUSD to the treasury, the worker sends back CSPR minus a fee. Both
// legs are real on chain transfers. Idempotent, every fulfilled transfer is recorded so
// it is never paid twice. On the first run it marks all existing transfers as seen, so
// historical funding like the faucet is never mistaken for a buy.
//
// The browser cannot attach CSPR to a contract call, so this off chain worker is how the
// dApp buy and sell work, the dApp only sends plain transfers the wallet supports.

const STATE_FILE = process.env.SWAP_STATE_FILE ?? "./swap-state.json";
const POLL_MS = Number(process.env.SWAP_POLL_MS ?? 15000);
const TREASURY = config.treasuryAccount.replace(/^account-hash-/, "");
const TOKEN = config.payTokenHash.replace(/^hash-/, "");
const API = "https://api.testnet.cspr.cloud";

const MIN_CSPR_MOTES = 1_000_000_000n; // ignore buys under 1 CSPR
const MIN_SUSD = 1_000_000_000n; // ignore sells under 1 sUSD

interface State {
  processed: Record<string, true>;
  init: boolean;
}

function loadState(): State {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    // fall through
  }
  return { processed: {}, init: false };
}
function saveState(s: State): void {
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

async function cloud(path: string): Promise<any[]> {
  const r = await fetch(`${API}/${path}`, { headers: { authorization: config.csprCloudKey } });
  if (!r.ok) return [];
  const body = await r.json();
  return body.data ?? [];
}

async function main(): Promise<void> {
  const sdk: any = await import("casper-js-sdk");
  const {
    HttpHandler,
    RpcClient,
    Args,
    CLValue,
    Key,
    AccountHash,
    NativeTransferBuilder,
    ContractCallBuilder,
    PrivateKey,
    KeyAlgorithm,
  } = sdk;
  const rpc = new RpcClient(new HttpHandler(config.node));
  const pem = await (await import("node:fs/promises")).readFile(config.agentSecretKey, "utf8");
  const priv = PrivateKey.fromPem(pem, KeyAlgorithm.SECP256K1);

  async function sendSusd(toHash: string, amount: bigint): Promise<string> {
    const tx = new ContractCallBuilder()
      .byPackageHash(TOKEN)
      .entryPoint("transfer")
      .runtimeArgs(
        Args.fromMap({
          recipient: CLValue.newCLKey(Key.newKey(`account-hash-${toHash}`)),
          amount: CLValue.newCLUInt256(amount.toString()),
        }),
      )
      .payment(5_000_000_000)
      .chainName(config.chain)
      .from(priv.publicKey)
      .buildFor1_5();
    tx.sign(priv);
    const res = await rpc.putTransaction(tx);
    const h = res.transactionHash;
    return h?.transactionV1?.toHex?.() ?? h?.deploy?.toHex?.() ?? String(h);
  }

  async function sendCspr(toHash: string, motes: bigint): Promise<string> {
    const tx = new NativeTransferBuilder()
      .from(priv.publicKey)
      .targetAccountHash(AccountHash.fromString(`account-hash-${toHash}`))
      .amount(motes.toString())
      .id(Date.now() % 1_000_000)
      .chainName(config.chain)
      .payment(100_000_000)
      .build();
    tx.sign(priv);
    const res = await rpc.putTransaction(tx);
    const h = res.transactionHash;
    return h?.transactionV1?.toHex?.() ?? h?.deploy?.toHex?.() ?? String(h);
  }

  async function pollOnce(state: State): Promise<void> {
    const natives = await cloud(`accounts/${TREASURY}/transfers?page_size=50`);
    const ftActions = await cloud(`accounts/${TREASURY}/ft-token-actions?page_size=50`);

    // Buys, incoming native CSPR to the treasury from a user account.
    const buys = natives
      .filter((t) => t.to_account_hash === TREASURY && t.initiator_account_hash !== TREASURY)
      .map((t) => ({
        id: `n-${t.deploy_hash}-${t.transfer_index}`,
        from: t.initiator_account_hash as string,
        amount: BigInt(t.amount),
      }));

    // Sells, incoming sUSD to the treasury from a user account.
    const sells = ftActions
      .filter(
        (a) =>
          a.to_hash === TREASURY &&
          a.to_type === 0 &&
          a.from_hash !== TREASURY &&
          a.from_type === 0 &&
          a.contract_package_hash === TOKEN,
      )
      .map((a) => ({
        id: `f-${a.deploy_hash}-${a.transform_idx}`,
        from: a.from_hash as string,
        amount: BigInt(a.amount),
      }));

    if (!state.init) {
      for (const b of buys) state.processed[b.id] = true;
      for (const s of sells) state.processed[s.id] = true;
      state.init = true;
      saveState(state);
      console.log(`init, marked ${buys.length + sells.length} existing transfers as seen`);
      return;
    }

    for (const b of buys) {
      if (state.processed[b.id]) continue;
      if (b.amount < MIN_CSPR_MOTES) {
        state.processed[b.id] = true;
        continue;
      }
      // 1 CSPR (1e9 motes) buys buyRate sUSD (buyRate * 1e9 atomic). So sUSD atomic =
      // CSPR motes * buyRate, both have 9 decimals.
      const susd = b.amount * BigInt(config.buyRate);
      try {
        const tx = await sendSusd(b.from, susd);
        state.processed[b.id] = true;
        saveState(state);
        console.log(`BUY ${b.from.slice(0, 8)} paid ${b.amount} motes, sent ${susd} sUSD, tx ${tx}`);
      } catch (e) {
        console.error(`buy fulfil failed for ${b.id}`, e);
      }
    }

    for (const s of sells) {
      if (state.processed[s.id]) continue;
      if (s.amount < MIN_SUSD) {
        state.processed[s.id] = true;
        continue;
      }
      // CSPR motes = sUSD / buyRate, minus the sell fee.
      const gross = s.amount / BigInt(config.buyRate);
      const motes = (gross * BigInt(10000 - config.sellFeeBps)) / 10000n;
      try {
        const tx = await sendCspr(s.from, motes);
        state.processed[s.id] = true;
        saveState(state);
        console.log(`SELL ${s.from.slice(0, 8)} sent ${s.amount} sUSD, paid ${motes} motes, tx ${tx}`);
      } catch (e) {
        console.error(`sell fulfil failed for ${s.id}`, e);
      }
    }
  }

  const state = loadState();
  console.log(`swap worker up, treasury ${TREASURY.slice(0, 10)}, rate 1 CSPR = ${config.buyRate} sUSD, sell fee ${config.sellFeeBps / 100}%`);
  for (;;) {
    try {
      await pollOnce(state);
    } catch (e) {
      console.error("poll failed", e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
