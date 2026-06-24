// Solvent dApp front end. CSPR.click handles multi wallet connect, signing and
// submission. casper-js-sdk builds the vault deposit and withdraw transactions.
const VAULT_PKG = "99abf0408b2c799aabf8b1b3d275d1117b0a2ca020657ec0f1fd4664b0638389";
const CHAIN = "casper-test";
const EXPLORER = "https://testnet.cspr.live/deploy/";
const SDK_URL = "https://esm.sh/casper-js-sdk@5.0.12";

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
    const res = await window.csprclick.send(json, activeKey, (s) => console.log("status", s), 150);
    if (!res || res.cancelled) { showResult("err", "Cancelled in the wallet."); return; }
    if (res.error) { showResult("err", "Failed: " + res.error); return; }
    showResult("ok", "Submitted on chain.", EXPLORER + res.transactionHash, "View transaction ↗");
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
    const target = c.dataset.fill === "deposit" ? "deposit-amount" : "withdraw-amount";
    $(target).value = c.dataset.val === "all" ? ($("p-shares").textContent || "0") : c.dataset.val;
  };
});

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
    .then((data) => { if (data && data.length) { renderVault(data[data.length - 1]); renderFeed(data); } })
    .catch((e) => console.error("feed", e));
}
loadFeed();
setInterval(loadFeed, 8000);
