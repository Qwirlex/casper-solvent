// Solvent dApp front end. CSPR.click handles multi wallet connect, signing and
// submission. casper-js-sdk builds the vault deposit and withdraw transactions.
const VAULT_PKG = "99abf0408b2c799aabf8b1b3d275d1117b0a2ca020657ec0f1fd4664b0638389";
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
  const d = $("deposit-btn"), w = $("withdraw-btn");
  d.disabled = false; d.textContent = "Deposit into vault";
  w.disabled = false; w.textContent = "Withdraw shares";
  refreshShares();
}

// Read the connected account's real shares from chain through the read API. Falls
// back silently if the API is unreachable, the optimistic value stays on screen.
async function refreshShares() {
  if (!activeKey) return;
  try {
    const r = await fetch(`${API}/api/shares/${activeKey}`);
    if (!r.ok) return;
    const { shares } = await r.json();
    $("p-shares").textContent = fmt(shares);
  } catch (e) {
    console.warn("shares read", e);
  }
}
function onDisconnected() {
  activeKey = null;
  $("connect-btn").hidden = false;
  $("account-chip").hidden = true;
  $("position-empty").hidden = false;
  $("position-live").hidden = true;
  const d = $("deposit-btn"), w = $("withdraw-btn");
  d.disabled = true; d.textContent = "Connect wallet to deposit";
  w.disabled = true; w.textContent = "Connect wallet to withdraw";
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

async function submitVaultCall(entryPoint, argName, amount, btn) {
  if (!activeKey) return;
  if (!(amount > 0)) { showResult("err", "Enter an amount greater than zero."); return; }
  const original = btn.textContent;
  btn.disabled = true; btn.textContent = "Awaiting wallet…";
  try {
    const { ContractCallBuilder, Args, CLValue, PublicKey } = await sdk();
    const motes = BigInt(Math.round(amount * 1e9)).toString();
    const tx = new ContractCallBuilder()
      .byPackageHash(VAULT_PKG)
      .entryPoint(entryPoint)
      .runtimeArgs(Args.fromMap({ [argName]: CLValue.newCLUInt256(motes) }))
      .payment(5_000_000_000)
      .chainName(CHAIN)
      .from(PublicKey.fromHex(activeKey))
      .buildFor1_5();
    const json = tx.toJSON();
    showResult("ok", "Sent to your wallet. Approve to sign and submit…");
    let capturedHash = null;
    const onStatus = (status, data) => {
      console.log("csprclick status", status, data);
      if (data && typeof data === "object") {
        capturedHash =
          capturedHash ||
          data.deployHash || data.deploy_hash || data.transactionHash ||
          (data.deploy && (data.deploy.hash || data.deploy.deploy_hash)) ||
          (data.transaction && data.transaction.hash);
      } else if (typeof data === "string" && /^[0-9a-f]{60,}$/i.test(data)) {
        capturedHash = capturedHash || data;
      }
    };
    const res = await window.csprclick.send(json, activeKey, onStatus, 150);
    console.log("csprclick send result", res);
    if (!res || res.cancelled) { showResult("err", "Cancelled in the wallet."); return; }
    if (res.error) { showResult("err", "Failed: " + res.error); return; }
    const cc = res.csprCloudTransaction || {};
    const hash =
      res.transactionHash || res.deployHash || res.deploy_hash ||
      cc.deploy_hash || cc.transaction_hash || cc.hash || capturedHash;
    // Optimistically reflect the action, then reconcile with real on chain shares
    // once the deploy has had time to execute. The read API is the source of truth.
    const sharesEl = $("p-shares");
    const cur = parseFloat(sharesEl.textContent) || 0;
    sharesEl.textContent = String(entryPoint === "deposit" ? cur + amount : Math.max(0, cur - amount));
    setTimeout(() => { refreshShares(); refreshVaultOnChain(); }, 14000);
    setTimeout(() => { refreshShares(); refreshVaultOnChain(); }, 35000);
    if (hash && /^[0-9a-f]{60,}$/i.test(String(hash))) {
      showResult("ok", "Submitted on chain, pending confirmation.", EXPLORER + hash, "View transaction ↗");
    } else {
      showResult("ok", "Signed and sent, status " + (res.status || "pending") + ". Check your wallet activity for the deploy.");
    }
  } catch (e) {
    console.error(e);
    showResult("err", "Could not build or submit: " + (e && e.message ? e.message : String(e)));
  } finally {
    btn.disabled = false; btn.textContent = original;
  }
}

$("deposit-btn").onclick = () => submitVaultCall("deposit", "amount", parseFloat($("deposit-amount").value), $("deposit-btn"));
$("withdraw-btn").onclick = () => submitVaultCall("withdraw", "share_amount", parseFloat($("withdraw-amount").value), $("withdraw-btn"));

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
