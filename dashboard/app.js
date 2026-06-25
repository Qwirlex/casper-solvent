// Solvent dApp front end. CSPR.click handles multi wallet connect, signing and
// submission. casper-js-sdk builds the vault deposit and withdraw transactions.
const VAULT_PKG = "ce214af4e290a0bbac67c80040c78acd8ba42b30bce315593ae7666411854bc8";
const PAY_TOKEN_PKG = "f7b25be95ff7c6ecb3518b2d8cd3fbad89949551661e99509f544673fe39ce59";
// Exchange treasury, holds CSPR and sUSD, run by the agent. Buy sends CSPR here, sell
// sends sUSD here, the worker pays the other side back.
const TREASURY = "c9c6b8f622cbeee77fca9e6e5d3f739f30e4116a1f5c41f6ccf2e0ddedb84383";
const BUY_RATE = 10; // sUSD per CSPR
const CHAIN = "casper-test";
const EXPLORER = "https://testnet.cspr.live/deploy/";
const SDK_URL = "https://esm.sh/casper-js-sdk@5.0.12";
// Read API base. Same origin behind the Caddy reverse_proxy at /api. Override for
// local dev with window.SOLVENT_API.
const API = (typeof window !== "undefined" && window.SOLVENT_API) || "";

let activeKey = null;
let sdkPromise = null;
// esm.sh bundles casper-js-sdk under a single default export, so unwrap it.
function sdk() { return (sdkPromise = sdkPromise || import(SDK_URL).then((m) => m.default || m)); }

const $ = (id) => document.getElementById(id);
function fmt(motes) { return (Number(motes) / 1e9).toLocaleString("en-US", { maximumFractionDigits: 4 }); }
function shortKey(k) { return k ? k.slice(0, 6) + "…" + k.slice(-4) : ""; }
function el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt !== undefined) e.textContent = txt; return e; }

/* ---------- wallet ---------- */
function onConnected(key) {
  activeKey = key;
  $("connect-btn").hidden = true;
  $("account-chip").hidden = false;
  $("account-key").textContent = shortKey(key);
  $("position-empty").hidden = true;
  $("position-live").hidden = false;
  $("p-wallet").textContent = shortKey(key);
  const a = $("approve-btn"), d = $("deposit-btn"), w = $("withdraw-btn");
  a.disabled = false; a.textContent = "1. Approve sUSD";
  d.disabled = true; d.textContent = "2. Deposit (approve first)";
  w.disabled = false; w.textContent = "Withdraw shares";
  const bb = $("buy-btn"), sb = $("sell-btn");
  if (bb) { bb.disabled = false; bb.textContent = "Buy sUSD"; }
  if (sb) { sb.disabled = false; sb.textContent = "Sell sUSD"; }
  const ta = $("treasury-addr"); if (ta) ta.textContent = TREASURY.slice(0, 10) + "…";
  refreshPosition();
  refreshWalletBalance();
}

// Wallet sUSD balance, what a buy delivers.
async function refreshWalletBalance() {
  if (!activeKey) return;
  try {
    const r = await fetch(`${API}/api/balance/${activeKey}`);
    if (!r.ok) return;
    const b = await r.json();
    const el = $("w-susd"); if (el) el.textContent = fmt(b.balance) + " sUSD";
  } catch (e) { console.warn("balance read", e); }
}

// Read the connected account's shares, current value, and earned yield from chain.
// Earned is the holder's proportional slice of the vault yield, computed on chain, so
// it is correct without any device side cost basis. Falls back silently.
async function refreshPosition() {
  if (!activeKey) return;
  try {
    const r = await fetch(`${API}/api/shares/${activeKey}`);
    if (!r.ok) return;
    const p = await r.json();
    $("p-deposited").textContent = fmt(p.deposited) + " sUSD";
    $("p-value").textContent = fmt(p.value) + " sUSD";
    const earned = Number(p.earned || 0) / 1e9;
    const deposited = Number(p.deposited || 0) / 1e9;
    const pct = deposited > 0 ? (earned / deposited) * 100 : 0;
    const el = $("p-earned");
    el.textContent = "+" + earned.toLocaleString("en-US", { maximumFractionDigits: 4 }) + ` sUSD (+${pct.toFixed(2)}%)`;
    el.classList.toggle("up", earned > 0);
  } catch (e) {
    console.warn("position read", e);
  }
}
function onDisconnected() {
  activeKey = null;
  $("connect-btn").hidden = false;
  $("account-chip").hidden = true;
  $("position-empty").hidden = false;
  $("position-live").hidden = true;
  const a = $("approve-btn"), d = $("deposit-btn"), w = $("withdraw-btn");
  a.disabled = true; d.disabled = true; w.disabled = true;
  d.textContent = "Connect wallet to deposit";
  w.textContent = "Connect wallet to withdraw";
  const bb = $("buy-btn"), sb = $("sell-btn");
  if (bb) { bb.disabled = true; bb.textContent = "Connect wallet to buy"; }
  if (sb) { sb.disabled = true; sb.textContent = "Connect wallet to sell"; }
}

function wireCsprClick() {
  const cc = window.csprclick;
  if (!cc) return;
  $("connect-btn").onclick = () => cc.signIn();
  $("disconnect-btn").onclick = () => cc.signOut && cc.signOut();
  if (cc.on) {
    cc.on("csprclick:signed_in", async () => { try { onConnected(await cc.getActivePublicKey()); } catch (e) { console.error(e); } });
    cc.on("csprclick:switched_account", async () => { try { onConnected(await cc.getActivePublicKey()); } catch (e) { console.error(e); } });
    cc.on("csprclick:signed_out", onDisconnected);
  }
  if (cc.getActivePublicKey) cc.getActivePublicKey().then((k) => { if (k) onConnected(k); }).catch(() => {});
}
if (window.csprclick) wireCsprClick();
else window.addEventListener("csprclick:loaded", wireCsprClick);

/* ---------- deposit / withdraw ---------- */
function showResultIn(boxId, kind, text, linkUrl, linkLabel) {
  const box = $(boxId);
  box.hidden = false;
  box.className = "tx-result " + kind;
  box.textContent = "";
  box.appendChild(document.createTextNode(text + " "));
  if (linkUrl) {
    const a = document.createElement("a");
    a.href = linkUrl; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = linkLabel || "View ↗";
    box.appendChild(a);
  }
}
function showResult(kind, text, linkUrl, linkLabel) { showResultIn("tx-result", kind, text, linkUrl, linkLabel); }
function showX(kind, text, linkUrl, linkLabel) { showResultIn("x-result", kind, text, linkUrl, linkLabel); }

// Build, sign and submit a contract call through CSPR.click. argsFn receives the SDK
// CLValue and Key constructors and returns the runtime args map. Returns the captured
// transaction hash, or null on cancel or error.
async function sendCall(pkg, entryPoint, argsFn, btn, signMsg, boxId) {
  const box = boxId || "tx-result";
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "Awaiting wallet…";
  try {
    const { ContractCallBuilder, Args, CLValue, Key, PublicKey } = await sdk();
    const tx = new ContractCallBuilder()
      .byPackageHash(pkg)
      .entryPoint(entryPoint)
      .runtimeArgs(Args.fromMap(argsFn(CLValue, Key)))
      .payment(5_000_000_000)
      .chainName(CHAIN)
      .from(PublicKey.fromHex(activeKey))
      .buildFor1_5();
    const json = tx.toJSON();
    showResultIn(box, "ok", signMsg);
    let capturedHash = null;
    const onStatus = (status, data) => {
      console.log("csprclick status", status, data);
      if (data && typeof data === "object") {
        capturedHash = capturedHash || data.deployHash || data.deploy_hash || data.transactionHash ||
          (data.deploy && (data.deploy.hash || data.deploy.deploy_hash)) || (data.transaction && data.transaction.hash);
      } else if (typeof data === "string" && /^[0-9a-f]{60,}$/i.test(data)) {
        capturedHash = capturedHash || data;
      }
    };
    const res = await window.csprclick.send(json, activeKey, onStatus, 150);
    console.log("csprclick send result", res);
    if (!res || res.cancelled) { showResultIn(box, "err", "Cancelled in the wallet."); return null; }
    if (res.error) { showResultIn(box, "err", "Failed: " + res.error); return null; }
    const cc = res.csprCloudTransaction || {};
    return res.transactionHash || res.deployHash || res.deploy_hash ||
      cc.deploy_hash || cc.transaction_hash || cc.hash || capturedHash || "pending";
  } catch (e) {
    console.error(e);
    showResultIn(box, "err", "Could not build or submit: " + (e && e.message ? e.message : String(e)));
    return null;
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

function txDone(hash, msg) {
  if (hash && /^[0-9a-f]{60,}$/i.test(String(hash))) showResult("ok", msg, EXPLORER + hash, "View transaction ↗");
  else showResult("ok", msg + " Check your wallet activity for the transaction.");
}
function reconcile() {
  setTimeout(() => { refreshPosition(); refreshVaultOnChain(); }, 16000);
  setTimeout(() => { refreshPosition(); refreshVaultOnChain(); }, 40000);
}
function amountMotes(id) {
  const v = parseFloat($(id).value);
  if (!(v > 0)) { showResult("err", "Enter an amount greater than zero."); return null; }
  return { v, motes: BigInt(Math.round(v * 1e9)).toString() };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Keep the deposit button locked until the approval has executed on chain. Polls the
// transaction status, so the user cannot deposit before the allowance is set, which is
// what caused the insufficient allowance revert.
async function awaitApproval(hash) {
  const dep = $("deposit-btn");
  dep.disabled = true; dep.textContent = "Waiting for approval…";
  const valid = hash && /^[0-9a-f]{60,}$/i.test(String(hash));
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    if (valid) {
      try {
        const s = await (await fetch(`${API}/api/tx/${hash}`)).json();
        if (s.executed) {
          if (s.success) {
            dep.disabled = false; dep.textContent = "2. Deposit";
            showResult("ok", "Approval confirmed on chain. Click Deposit now.");
          } else {
            dep.textContent = "2. Deposit (approve first)";
            showResult("err", "Approval failed: " + (s.error || "unknown"));
          }
          return;
        }
      } catch (e) { console.warn("tx poll", e); }
    }
    await sleep(6000);
  }
  // Fallback if the status never resolved, enable but warn.
  dep.disabled = false; dep.textContent = "2. Deposit";
  showResult("ok", "Approval is taking longer than usual. If Deposit fails with an allowance error, wait a bit and try again.");
}

// Step one, approve the vault to pull the deposit. The vault custodies the tokens.
async function doApprove() {
  if (!activeKey) return;
  const a = amountMotes("deposit-amount"); if (!a) return;
  const hash = await sendCall(
    PAY_TOKEN_PKG, "approve",
    (CLValue, Key) => ({ spender: CLValue.newCLKey(Key.newKey("hash-" + VAULT_PKG)), amount: CLValue.newCLUInt256(a.motes) }),
    $("approve-btn"), "Approval sent to your wallet, sign it.",
  );
  if (hash) {
    txDone(hash, "Approval submitted, confirming on chain. Deposit unlocks once it is in.");
    awaitApproval(hash);
  }
}

// Step two, deposit the approved amount and receive shares. Only reachable after the
// approval has confirmed, the button is locked until then.
async function doDeposit() {
  if (!activeKey) return;
  const a = amountMotes("deposit-amount"); if (!a) return;
  const hash = await sendCall(
    VAULT_PKG, "deposit",
    (CLValue) => ({ amount: CLValue.newCLUInt256(a.motes) }),
    $("deposit-btn"), "Deposit sent to your wallet, sign it.",
  );
  if (hash) {
    txDone(hash, "Deposit submitted on chain, pending confirmation.");
    // Register so the agent accrues yield to this account.
    fetch(`${API}/api/depositor`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ account: activeKey }),
    }).catch(() => {});
    reconcile();
    // Require a fresh approval for the next deposit, the allowance was spent.
    const dep = $("deposit-btn"); dep.disabled = true; dep.textContent = "2. Deposit (approve first)";
  }
}

async function doWithdraw() {
  if (!activeKey) return;
  const a = amountMotes("withdraw-amount"); if (!a) return;
  const hash = await sendCall(
    VAULT_PKG, "withdraw",
    (CLValue) => ({ share_amount: CLValue.newCLUInt256(a.motes) }),
    $("withdraw-btn"), "Withdraw sent to your wallet, sign it.",
  );
  if (hash) { txDone(hash, "Withdraw submitted on chain, pending confirmation."); reconcile(); }
}

$("approve-btn").onclick = doApprove;
$("deposit-btn").onclick = doDeposit;
$("withdraw-btn").onclick = doWithdraw;

/* ---------- exchange, buy and sell sUSD for CSPR ---------- */
// Buy, send native CSPR to the treasury, the worker returns sUSD.
async function doBuy() {
  if (!activeKey) return;
  const v = parseFloat($("buy-amount").value);
  if (!(v > 0)) { showX("err", "Enter a CSPR amount."); return; }
  const motes = BigInt(Math.round(v * 1e9)).toString();
  const btn = $("buy-btn"); const orig = btn.textContent;
  btn.disabled = true; btn.textContent = "Awaiting wallet…";
  try {
    const { NativeTransferBuilder, AccountHash, PublicKey } = await sdk();
    const tx = new NativeTransferBuilder()
      .from(PublicKey.fromHex(activeKey))
      .targetAccountHash(AccountHash.fromString("account-hash-" + TREASURY))
      .amount(motes)
      .id(Date.now() % 1000000)
      .chainName(CHAIN)
      .payment(100000000)
      .build();
    showX("ok", "Sent to your wallet, sign the CSPR transfer.");
    const res = await window.csprclick.send(tx.toJSON(), activeKey, () => {}, 150);
    if (!res || res.cancelled) { showX("err", "Cancelled in the wallet."); return; }
    if (res.error) { showX("err", "Failed: " + res.error + ". You can also send CSPR yourself to the treasury address below."); return; }
    showX("ok", `Sent ${v} CSPR. The exchange will send about ${v * BUY_RATE} sUSD to your wallet shortly.`);
    setTimeout(refreshWalletBalance, 18000);
    setTimeout(refreshWalletBalance, 45000);
  } catch (e) {
    console.error(e);
    showX("err", "Could not submit: " + (e && e.message ? e.message : String(e)) + ". Send CSPR yourself to the treasury address below.");
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

// Sell, send sUSD to the treasury, the worker returns CSPR minus the fee.
async function doSell() {
  if (!activeKey) return;
  const v = parseFloat($("sell-amount").value);
  if (!(v > 0)) { showX("err", "Enter an sUSD amount."); return; }
  const motes = BigInt(Math.round(v * 1e9)).toString();
  const hash = await sendCall(
    PAY_TOKEN_PKG, "transfer",
    (CLValue, Key) => ({ recipient: CLValue.newCLKey(Key.newKey("account-hash-" + TREASURY)), amount: CLValue.newCLUInt256(motes) }),
    $("sell-btn"), "Sell sent to your wallet, sign the sUSD transfer.", "x-result",
  );
  if (hash) {
    const cspr = ((v / BUY_RATE) * 0.9).toLocaleString("en-US", { maximumFractionDigits: 4 });
    if (/^[0-9a-f]{60,}$/i.test(String(hash))) showX("ok", `Sold ${v} sUSD. The exchange will send about ${cspr} CSPR back shortly.`, EXPLORER + hash, "View transaction ↗");
    else showX("ok", `Sold ${v} sUSD. The exchange will send about ${cspr} CSPR back shortly.`);
    setTimeout(refreshWalletBalance, 18000);
    setTimeout(refreshWalletBalance, 45000);
  }
}

$("buy-btn").onclick = doBuy;
$("sell-btn").onclick = doSell;

// Exchange amount hints.
function updateXHint(which) {
  const inp = $(which + "-amount"), hint = $(which + "-hint");
  if (!inp || !hint) return;
  hint.textContent = "";
  const v = parseFloat(inp.value);
  if (!(v > 0)) return;
  if (which === "buy") hint.textContent = `${v} CSPR → about ${v * BUY_RATE} sUSD`;
  else hint.textContent = `${v} sUSD → about ${((v / BUY_RATE) * 0.9).toFixed(4)} CSPR after fee`;
}
$("buy-amount").addEventListener("input", () => updateXHint("buy"));
$("sell-amount").addEventListener("input", () => updateXHint("sell"));

document.querySelectorAll(".xtab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".xtab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("xtab-buy").hidden = t.dataset.xtab !== "buy";
    $("xtab-sell").hidden = t.dataset.xtab !== "sell";
  };
});

document.querySelectorAll(".tab").forEach((t) => {
  t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    $("tab-deposit").hidden = t.dataset.tab !== "deposit";
    $("tab-withdraw").hidden = t.dataset.tab !== "withdraw";
  };
});
document.querySelectorAll(".chip-btn").forEach((c) => {
  c.onclick = () => {
    const which = c.dataset.fill === "deposit" ? "deposit" : "withdraw";
    const maxVal = (($("p-value").textContent || "0").replace(/[^0-9.]/g, "")) || "0";
    $(which + "-amount").value = c.dataset.val === "all" ? maxVal : c.dataset.val;
    updateHint(which);
  };
});

// Hint under the input. Both deposit and withdraw are in sUSD now. Show the raw on
// chain units so the big number the wallet shows is not a surprise.
function updateHint(which) {
  const inp = $(which + "-amount"), hint = $(which + "-hint");
  if (!inp || !hint) return;
  hint.textContent = "";
  const v = parseFloat(inp.value);
  if (!(v > 0)) return;
  const units = BigInt(Math.round(v * 1e9)).toLocaleString("en-US");
  hint.appendChild(document.createTextNode(`${v} sUSD = `));
  hint.appendChild(el("span", "units", `${units} units on chain`));
  hint.appendChild(document.createTextNode(", the wallet shows this raw number"));
}
$("deposit-amount").addEventListener("input", () => updateHint("deposit"));
$("withdraw-amount").addEventListener("input", () => updateHint("withdraw"));

/* ---------- vault stats + agent feed ---------- */
function fmtTs(ts) { return new Date(ts).toLocaleString("en-US", { hour12: false }); }
function isHash(h) { return typeof h === "string" && /^[0-9a-f]{16,}$/i.test(h); }
function txa(hash, label) {
  if (!isHash(hash)) return el("span", "mono", label);
  const a = document.createElement("a"); a.href = EXPLORER + hash; a.target = "_blank"; a.rel = "noopener noreferrer"; a.textContent = label; return a;
}

// The vault card is read straight from the vault contract through the read API, so the
// headline numbers are always chain truth.
async function refreshVaultOnChain() {
  try {
    const r = await fetch(`${API}/api/vault`);
    if (!r.ok) return;
    const v = await r.json();
    $("v-assets").textContent = fmt(v.totalAssets) + " sUSD";
    $("v-cons").textContent = v.allocation.conservative + "%";
    $("v-grow").textContent = v.allocation.growth + "%";
    $("v-allocbar").style.width = v.allocation.conservative + "%";
    if (v.totalPrincipal !== undefined) $("v-principal").textContent = fmt(v.totalPrincipal) + " sUSD";
    if (v.totalYield !== undefined) $("v-yield").textContent = fmt(v.totalYield) + " sUSD";
  } catch (e) {
    console.warn("vault read", e);
  }
}
// Plain English summary of a cycle from the numbers, no model flavored text.
function cycleSentence(c) {
  const g = c.allocationAfter.growth;
  const risk = c.riskScore;
  const level = risk <= 20 ? "low" : risk <= 50 ? "moderate" : "high";
  return `Risk looked ${level}, so the agent put ${g}% into growth and kept ${100 - g}% safe.`;
}

function renderFeed(cycles) {
  const feed = $("loop-feed"); feed.textContent = "";
  cycles.slice().reverse().forEach((c) => {
    const card = el("div", "cycle-card");
    const head = el("div", "cycle-head");
    head.appendChild(el("span", "cycle-ts", fmtTs(c.ts)));
    head.appendChild(el("span", "cycle-mix", `${c.allocationAfter.growth}% growth`));
    card.appendChild(head);
    card.appendChild(el("div", "cycle-reason", cycleSentence(c)));

    const tx = el("div", "cycle-tx");
    const pays = c.x402Payments || [];
    const acts = [];
    if (pays[0]) acts.push(["Bought market data", pays[0].txHash]);
    if (pays[1]) acts.push(["Scored the risk", pays[1].txHash]);
    acts.push(["Rebalanced the pool", c.rebalanceTxHash]);
    if (c.accrueTxHash) acts.push(["Added yield", c.accrueTxHash]);
    acts.forEach(([label, hash]) => {
      const a = el("span", "act");
      a.appendChild(el("span", "act-lbl", label + " "));
      a.appendChild(txa(hash, "↗"));
      tx.appendChild(a);
    });
    card.appendChild(tx);
    feed.appendChild(card);
  });
}
function loadFeed() {
  // The vault headline is always chain truth. The loop log only feeds the activity list.
  refreshVaultOnChain();
  fetch("loop-log.json").then((r) => { if (!r.ok) throw 0; return r.json(); })
    .catch(() => fetch("sample-loop-log.json").then((r) => r.json()))
    .then((data) => { if (data && data.length) renderFeed(data); })
    .catch((e) => console.error("feed", e));
}
loadFeed();
setInterval(loadFeed, 8000);
