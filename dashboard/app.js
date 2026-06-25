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
// Principal the user has put in through this dApp, per account, so earned can be shown
// as current value minus what was deposited. Kept on the device, the share value
// itself is always read from chain.
function principalKey(k) { return "solvent_principal_" + k; }
function getPrincipal(k) { return parseFloat(localStorage.getItem(principalKey(k)) || "0") || 0; }
function addPrincipal(k, delta) { localStorage.setItem(principalKey(k), String(Math.max(0, getPrincipal(k) + delta))); }

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
  d.disabled = false; d.textContent = "2. Deposit";
  w.disabled = false; w.textContent = "Withdraw shares";
  refreshPosition();
}

// Read the connected account's real shares and current value from chain through the
// read API, and show earned against the tracked principal. Falls back silently.
async function refreshPosition() {
  if (!activeKey) return;
  try {
    const r = await fetch(`${API}/api/shares/${activeKey}`);
    if (!r.ok) return;
    const p = await r.json();
    const valueSusd = Number(p.value) / 1e9;
    $("p-shares").textContent = fmt(p.shares);
    $("p-value").textContent = fmt(p.value) + " sUSD";
    const principal = getPrincipal(activeKey);
    const earned = valueSusd - principal;
    const el = $("p-earned");
    if (principal > 0) {
      const pct = principal > 0 ? (earned / principal) * 100 : 0;
      el.textContent = (earned >= 0 ? "+" : "") + earned.toLocaleString("en-US", { maximumFractionDigits: 4 }) + ` sUSD (${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`;
      el.classList.toggle("up", earned >= 0);
    } else {
      el.textContent = "deposit to start tracking";
      el.classList.remove("up");
    }
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

// Step one, approve the vault to pull the deposit. The vault custodies the tokens.
async function doApprove() {
  if (!activeKey) return;
  const a = amountMotes("deposit-amount"); if (!a) return;
  const hash = await sendCall(
    PAY_TOKEN_PKG, "approve",
    (CLValue, Key) => ({ spender: CLValue.newCLKey(Key.newKey("hash-" + VAULT_PKG)), amount: CLValue.newCLUInt256(a.motes) }),
    $("approve-btn"), "Approval sent to your wallet, sign it.",
  );
  if (hash) txDone(hash, "Approval submitted. Wait about thirty seconds for it to confirm, then click Deposit.");
}

// Step two, deposit the approved amount and receive shares.
async function doDeposit() {
  if (!activeKey) return;
  const a = amountMotes("deposit-amount"); if (!a) return;
  const hash = await sendCall(
    VAULT_PKG, "deposit",
    (CLValue) => ({ amount: CLValue.newCLUInt256(a.motes) }),
    $("deposit-btn"), "Deposit sent to your wallet, sign it.",
  );
  if (hash) { addPrincipal(activeKey, a.v); txDone(hash, "Deposit submitted on chain, pending confirmation."); reconcile(); }
}

async function doWithdraw() {
  if (!activeKey) return;
  const a = amountMotes("withdraw-amount"); if (!a) return;
  const hash = await sendCall(
    VAULT_PKG, "withdraw",
    (CLValue) => ({ share_amount: CLValue.newCLUInt256(a.motes) }),
    $("withdraw-btn"), "Withdraw sent to your wallet, sign it.",
  );
  if (hash) { addPrincipal(activeKey, -a.v); txDone(hash, "Withdraw submitted on chain, pending confirmation."); reconcile(); }
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

// Show the on chain atomic units under the input so the big number the wallet shows is
// not a surprise. sUSD has 9 decimals, so 10 sUSD is 10,000,000,000 units.
function updateHint(which) {
  const inp = $(which + "-amount"), hint = $(which + "-hint");
  if (!inp || !hint) return;
  hint.textContent = "";
  const v = parseFloat(inp.value);
  if (!(v > 0)) return;
  const units = BigInt(Math.round(v * 1e9)).toLocaleString("en-US");
  const unit = which === "deposit" ? "sUSD" : "shares";
  hint.appendChild(document.createTextNode(`${v} ${unit} = `));
  const u = el("span", "units", `${units} units on chain`);
  hint.appendChild(u);
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

function renderVault(latest) {
  $("v-assets").textContent = fmt(latest.vaultAssets) + " sUSD";
  const a = latest.allocationAfter;
  $("v-cons").textContent = a.conservative + "%";
  $("v-grow").textContent = a.growth + "%";
  $("v-allocbar").style.width = a.conservative + "%";
}

// Override the vault card with real on chain state from the read API. The agent feed
// still comes from the loop log, but the headline numbers are read straight from the
// vault contract so they are always the chain truth.
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
      const price = Number(v.sharePrice) / 1e9;
      const growth = (price - 1) * 100;
      $("v-price").textContent = price.toFixed(4) + (growth ? `  (+${growth.toFixed(2)}%)` : "");
    }
    if (v.totalYield !== undefined) $("v-yield").textContent = fmt(v.totalYield) + " sUSD";
  } catch (e) {
    console.warn("vault read", e);
  }
}
function renderFeed(cycles) {
  const feed = $("loop-feed"); feed.textContent = "";
  cycles.slice().reverse().forEach((c) => {
    const card = el("div", "cycle-card");
    const head = el("div", "cycle-head");
    head.appendChild(el("span", "cycle-ts", fmtTs(c.ts)));
    head.appendChild(el("span", "cycle-ref", c.decisionRef));
    card.appendChild(head);
    card.appendChild(el("div", "cycle-reason", c.reason));
    const al = el("div", "cycle-alloc");
    al.appendChild(el("span", "lbl", "Rebalance"));
    al.appendChild(el("span", "pill b", `C ${c.allocationBefore.conservative}/G ${c.allocationBefore.growth}`));
    al.appendChild(el("span", "arr", "→"));
    al.appendChild(el("span", "pill a", `C ${c.allocationAfter.conservative}/G ${c.allocationAfter.growth}`));
    card.appendChild(al);
    const tx = el("div", "cycle-tx");
    (c.x402Payments || []).forEach((p) => {
      const wrap = el("span");
      wrap.appendChild(el("span", "lbl", p.label.split(" ")[0] + " pay "));
      wrap.appendChild(txa(p.txHash, "tx ↗"));
      tx.appendChild(wrap);
    });
    const rb = el("span");
    rb.appendChild(el("span", "lbl", "rebalance "));
    rb.appendChild(txa(c.rebalanceTxHash, "tx ↗"));
    tx.appendChild(rb);
    card.appendChild(tx);
    feed.appendChild(card);
  });
}
function loadFeed() {
  fetch("loop-log.json").then((r) => { if (!r.ok) throw 0; return r.json(); })
    .catch(() => fetch("sample-loop-log.json").then((r) => r.json()))
    .then((data) => {
      if (data && data.length) { renderVault(data[data.length - 1]); renderFeed(data); }
      refreshVaultOnChain(); // chain truth overrides the headline numbers
    })
    .catch((e) => console.error("feed", e));
}
loadFeed();
setInterval(loadFeed, 8000);
