var CSPR_LIVE = "https://testnet.cspr.live/deploy/";
var POLL_INTERVAL = 5000;

function fmtAmount(raw) {
  var val = Number(raw) / 1e9;
  return val.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 4 }) + " sUSD";
}

function fmtTs(ts) {
  return new Date(ts).toLocaleString("en-US", { hour12: false });
}

function txLink(hash, label) {
  var a = document.createElement("a");
  a.href = CSPR_LIVE + hash;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = label || hash.slice(0, 12) + "...";
  return a;
}

function riskColor(score) {
  if (score < 33) return "#4caf50";
  if (score < 66) return "#ff9800";
  return "#f44336";
}

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function renderCurrentState(cycle) {
  var panel = document.getElementById("current-state");
  while (panel.firstChild) panel.removeChild(panel.firstChild);

  var statRow = el("div", "stat-row");

  var s1 = el("div", "stat");
  s1.appendChild(el("span", "stat-label", "Vault Assets"));
  s1.appendChild(el("span", "stat-value", fmtAmount(cycle.vaultAssets)));
  statRow.appendChild(s1);

  var s2 = el("div", "stat");
  s2.appendChild(el("span", "stat-label", "Feed Price"));
  s2.appendChild(el("span", "stat-value", "$" + cycle.feedPrice));
  statRow.appendChild(s2);

  var s3 = el("div", "stat");
  s3.appendChild(el("span", "stat-label", "Risk Score"));
  var riskVal = el("span", "stat-value risk-score", cycle.riskScore + " / 100");
  riskVal.style.color = riskColor(cycle.riskScore);
  s3.appendChild(riskVal);
  statRow.appendChild(s3);

  var s4 = el("div", "stat");
  s4.appendChild(el("span", "stat-label", "Last Updated"));
  s4.appendChild(el("span", "stat-value", fmtTs(cycle.ts)));
  statRow.appendChild(s4);

  panel.appendChild(statRow);

  var allocSection = el("div", "alloc-section");
  allocSection.appendChild(el("span", "stat-label", "Current Allocation"));

  var allocBars = el("div", "alloc-bars");
  var cons = cycle.allocationAfter.conservative;
  var grow = cycle.allocationAfter.growth;

  var consWrap = el("div", "alloc-bar-wrap");
  var consBar = el("div", "alloc-bar conservative");
  consBar.style.width = cons + "%";
  consWrap.appendChild(consBar);
  consWrap.appendChild(el("span", "alloc-label", "Conservative " + cons + "%"));
  allocBars.appendChild(consWrap);

  var growWrap = el("div", "alloc-bar-wrap");
  var growBar = el("div", "alloc-bar growth");
  growBar.style.width = grow + "%";
  growWrap.appendChild(growBar);
  growWrap.appendChild(el("span", "alloc-label", "Growth " + grow + "%"));
  allocBars.appendChild(growWrap);

  allocSection.appendChild(allocBars);
  panel.appendChild(allocSection);
}

function renderFeed(cycles) {
  var feed = document.getElementById("loop-feed");
  while (feed.firstChild) feed.removeChild(feed.firstChild);

  var reversed = cycles.slice().reverse();

  for (var i = 0; i < reversed.length; i++) {
    var cycle = reversed[i];
    var card = el("div", "cycle-card");

    var header = el("div", "cycle-header");
    header.appendChild(el("span", "cycle-ts", fmtTs(cycle.ts)));
    header.appendChild(el("span", "cycle-ref", cycle.decisionRef));
    card.appendChild(header);

    card.appendChild(el("div", "cycle-reason", cycle.reason));

    var allocDiv = el("div", "cycle-alloc");
    allocDiv.appendChild(el("span", "alloc-change-label", "Allocation shift:"));
    allocDiv.appendChild(document.createTextNode(" "));
    var bef = cycle.allocationBefore;
    var aft = cycle.allocationAfter;
    allocDiv.appendChild(el("span", "alloc-before", "C " + bef.conservative + "% / G " + bef.growth + "%"));
    allocDiv.appendChild(el("span", "alloc-arrow", " → "));
    allocDiv.appendChild(el("span", "alloc-after", "C " + aft.conservative + "% / G " + aft.growth + "%"));
    card.appendChild(allocDiv);

    if (cycle.x402Payments && cycle.x402Payments.length > 0) {
      var paymentsDiv = el("div", "cycle-payments");
      paymentsDiv.appendChild(el("div", "section-title", "x402 Payments out"));

      for (var j = 0; j < cycle.x402Payments.length; j++) {
        var p = cycle.x402Payments[j];
        var row = el("div", "payment-row");
        row.appendChild(el("span", "payment-label", p.label));
        row.appendChild(el("span", "payment-amount", fmtAmount(p.amount)));
        var txSpan = el("span", "payment-tx");
        txSpan.appendChild(txLink(p.txHash, p.txHash.slice(0, 14) + "..."));
        row.appendChild(txSpan);
        paymentsDiv.appendChild(row);
      }
      card.appendChild(paymentsDiv);
    }

    var feeDiv = el("div", "cycle-fee");
    feeDiv.appendChild(el("span", "section-title", "Fee harvested in: "));
    feeDiv.appendChild(el("span", "fee-amount", fmtAmount(cycle.feeHarvested)));
    card.appendChild(feeDiv);

    var rebalDiv = el("div", "cycle-rebal");
    rebalDiv.appendChild(el("span", "section-title", "Rebalance: "));
    rebalDiv.appendChild(txLink(cycle.rebalanceTxHash, "View rebalance tx"));
    card.appendChild(rebalDiv);

    feed.appendChild(card);
  }
}

function fetchData() {
  fetch("loop-log.json")
    .then(function(res) {
      if (!res.ok) throw new Error("not found");
      return res.json();
    })
    .catch(function() {
      return fetch("sample-loop-log.json").then(function(res) {
        if (!res.ok) throw new Error("sample not found");
        return res.json();
      });
    })
    .then(function(data) {
      if (!data || data.length === 0) {
        document.getElementById("current-state").textContent = "No cycle data yet.";
        document.getElementById("loop-feed").textContent = "Waiting for the first agent cycle...";
        return;
      }
      var latest = data[data.length - 1];
      renderCurrentState(latest);
      renderFeed(data);
    })
    .catch(function(err) {
      console.error("Could not load any log file:", err);
    });
}

fetchData();
setInterval(fetchData, POLL_INTERVAL);
