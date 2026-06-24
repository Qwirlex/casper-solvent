var EXPLORER = "https://testnet.cspr.live/deploy/";
var POLL_INTERVAL = 5000;

function fmtAmount(raw) {
  var val = Number(raw) / 1e9;
  return val.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 }) + " sUSD";
}
function fmtTs(ts) { return new Date(ts).toLocaleString("en-US", { hour12: false }); }
function riskColor(s) { if (s < 33) return "#34d399"; if (s < 66) return "#fbbf24"; return "#fb7185"; }
function isRealHash(h) { return typeof h === "string" && /^[0-9a-f]{16,}$/i.test(h); }

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function txLink(hash, label) {
  if (!isRealHash(hash)) { return el("span", "mono", label || hash); }
  var a = document.createElement("a");
  a.href = EXPLORER + hash;
  a.target = "_blank"; a.rel = "noopener noreferrer";
  a.className = "mono";
  a.textContent = label || hash.slice(0, 12) + "… ↗";
  return a;
}

function renderCurrentState(cycle) {
  var panel = document.getElementById("current-state");
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  var row = el("div", "stat-row");
  function stat(label, value, color) {
    var s = el("div", "stat");
    s.appendChild(el("span", "stat-label", label));
    var v = el("span", "stat-value", value);
    if (color) v.style.color = color;
    s.appendChild(v);
    return s;
  }
  row.appendChild(stat("Vault assets", fmtAmount(cycle.vaultAssets)));
  row.appendChild(stat("Feed price", "$" + cycle.feedPrice));
  row.appendChild(stat("Risk score", cycle.riskScore + " / 100", riskColor(cycle.riskScore)));
  row.appendChild(stat("Last cycle", fmtTs(cycle.ts)));
  panel.appendChild(row);

  var alloc = el("div", "alloc-section");
  alloc.appendChild(el("span", "stat-label", "Current allocation"));
  var bars = el("div", "alloc-bars");
  var a = cycle.allocationAfter;
  function bar(kind, label, pct) {
    var track = el("div", "alloc-track");
    var rail = el("div", "alloc-rail");
    var fill = el("div", "alloc-fill " + kind);
    fill.style.width = pct + "%";
    rail.appendChild(fill);
    track.appendChild(el("span", "alloc-label", label + " " + pct + "%"));
    track.appendChild(rail);
    return track;
  }
  bars.appendChild(bar("conservative", "Conservative", a.conservative));
  bars.appendChild(bar("growth", "Growth", a.growth));
  alloc.appendChild(bars);
  panel.appendChild(alloc);
}

function renderFeed(cycles) {
  var feed = document.getElementById("loop-feed");
  while (feed.firstChild) feed.removeChild(feed.firstChild);
  var list = cycles.slice().reverse();

  for (var i = 0; i < list.length; i++) {
    var c = list[i];
    var card = el("div", "cycle-card");

    var head = el("div", "cycle-header");
    head.appendChild(el("span", "cycle-ts", fmtTs(c.ts)));
    head.appendChild(el("span", "cycle-ref", c.decisionRef));
    card.appendChild(head);

    card.appendChild(el("div", "cycle-reason", c.reason));

    var ad = el("div", "cycle-alloc");
    ad.appendChild(el("span", "alloc-change-label", "Allocation"));
    var b = c.allocationBefore, af = c.allocationAfter;
    ad.appendChild(el("span", "pill before", "C " + b.conservative + " / G " + b.growth));
    ad.appendChild(el("span", "alloc-arrow", "→"));
    ad.appendChild(el("span", "pill after", "C " + af.conservative + " / G " + af.growth));
    card.appendChild(ad);

    var grid = el("div", "cycle-grid");

    var payCell = el("div", "cell");
    payCell.appendChild(el("div", "cell-title", "Service payments out, on chain"));
    if (c.x402Payments) {
      for (var j = 0; j < c.x402Payments.length; j++) {
        var p = c.x402Payments[j];
        var prow = el("div", "payment-row");
        prow.appendChild(el("span", null, p.label));
        prow.appendChild(el("span", "payment-amount", fmtAmount(p.amount)));
        prow.appendChild(txLink(p.txHash));
        payCell.appendChild(prow);
      }
    }
    grid.appendChild(payCell);

    var actCell = el("div", "cell");
    actCell.appendChild(el("div", "cell-title", "Rebalance and fee"));
    var rebal = el("div", "rebal-line");
    rebal.appendChild(document.createTextNode("Rebalance "));
    rebal.appendChild(txLink(c.rebalanceTxHash, "View tx ↗"));
    actCell.appendChild(rebal);
    var fee = el("div", "rebal-line");
    fee.appendChild(document.createTextNode("Fee skimmed "));
    fee.appendChild(el("span", "fee-amount", fmtAmount(c.feeHarvested)));
    actCell.appendChild(fee);
    grid.appendChild(actCell);

    card.appendChild(grid);
    feed.appendChild(card);
  }
}

function fetchData() {
  fetch("loop-log.json")
    .then(function (r) { if (!r.ok) throw new Error("no live log"); return r.json(); })
    .catch(function () { return fetch("sample-loop-log.json").then(function (r) { return r.json(); }); })
    .then(function (data) {
      if (!data || !data.length) {
        document.getElementById("current-state").textContent = "Waiting for the first agent cycle…";
        document.getElementById("loop-feed").textContent = "";
        return;
      }
      renderCurrentState(data[data.length - 1]);
      renderFeed(data);
      var hs = document.getElementById("hs-cycles");
      if (hs) hs.textContent = String(data.length);
    })
    .catch(function (e) { console.error("log load failed", e); });
}

fetchData();
setInterval(fetchData, POLL_INTERVAL);
