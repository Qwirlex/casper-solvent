// Solvent dApp front end. CSPR.click handles multi wallet connect, signing and
// submission. casper-js-sdk builds the vault deposit and withdraw transactions.
const VAULT_PKG = "ef636b715136655ffe4796aeb8e221ce236710f0dcf08c163f85cd39a8397711";
const PAY_TOKEN_PKG = "f7b25be95ff7c6ecb3518b2d8cd3fbad89949551661e99509f544673fe39ce59";
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
  refreshPosition();
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
    $("p-shares").textContent = fmt(p.shares);
    $("p-value").textContent = fmt(p.value) + " sUSD";
    const earned = Number(p.earned || 0) / 1e9;
    const value = Number(p.value || 0) / 1e9;
    const base = value - earned; // the deposited part, value minus yield
    const pct = base > 0 ? (earned / base) * 100 : 0;
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
function showResult(kind, text, linkUrl, linkLabel) {
  const box = $("tx-result");
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

// Build, sign and submit a contract call through CSPR.click. argsFn receives the SDK
// CLValue and Key constructors and returns the runtime args map. Returns the captured
// transaction hash, or null on cancel or error.
async function sendCall(pkg, entryPoint, argsFn, btn, signMsg) {
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
    showResult("ok", signMsg);
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
    if (!res || res.cancelled) { showResult("err", "Cancelled in the wallet."); return null; }
    if (res.error) { showResult("err", "Failed: " + res.error); return null; }
    const cc = res.csprCloudTransaction || {};
    return res.transactionHash || res.deployHash || res.deploy_hash ||
      cc.deploy_hash || cc.transaction_hash || cc.hash || capturedHash || "pending";
  } catch (e) {
    console.error(e);
    showResult("err", "Could not build or submit: " + (e && e.message ? e.message : String(e)));
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
    $(which + "-amount").value = c.dataset.val === "all" ? ($("p-shares").textContent || "0") : c.dataset.val;
    updateHint(which);
  };
});

// Current assets per share, updated from chain, used to show the sUSD a withdraw
// returns. One to one until yield accrues.
let sharePrice = 1;

// Hint under the input. Deposit shows the raw on chain units so the big wallet number
// is not a surprise. Withdraw shows the sUSD the shares redeem for, since the field is
// in shares but people think in dollars.
function updateHint(which) {
  const inp = $(which + "-amount"), hint = $(which + "-hint");
  if (!inp || !hint) return;
  hint.textContent = "";
  const v = parseFloat(inp.value);
  if (!(v > 0)) return;
  if (which === "withdraw") {
    const susd = (v * sharePrice).toLocaleString("en-US", { maximumFractionDigits: 4 });
    hint.appendChild(document.createTextNode(`${v} shares ≈ `));
    hint.appendChild(el("span", "units", `${susd} sUSD`));
    hint.appendChild(document.createTextNode(" you receive"));
    return;
  }
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
    if (v.sharePrice) {
      sharePrice = Number(v.sharePrice) / 1e9;
      const growth = (sharePrice - 1) * 100;
      $("v-price").textContent = sharePrice.toFixed(4) + (growth ? `  (+${growth.toFixed(2)}%)` : "");
    }
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
