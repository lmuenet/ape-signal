// Depot-UI frontend (read-only). LightweightCharts is loaded globally via
// /vendor/lightweight-charts.js (v4 standalone build).
const $ = (sel) => document.querySelector(sel);
const usd = (n) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
const ts = (iso) => Math.floor(Date.parse(iso) / 1000);

const CHART_OPTS = {
  layout: { background: { color: "transparent" }, textColor: "#8b96a8" },
  grid: { vertLines: { color: "#2a3342" }, horzLines: { color: "#2a3342" } },
  timeScale: { timeVisible: true, secondsVisible: false },
  height: 220,
  autoSize: true,
};

function priceLine(series, price, title, color) {
  if (typeof price !== "number") return;
  series.createPriceLine({ price, title, color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
}

async function api(path, asText = false) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return asText ? res.text() : res.json();
}

function positionCard(pos, quotes) {
  const q = quotes[pos.ticker];
  const pnl = q ? Math.max(pos.units * (q.close - pos.entryPrice) * (pos.side === "long" ? 1 : -1), -pos.stake) : null;
  const el = document.createElement("div");
  el.className = "card";
  el.innerHTML = `
    <b>${pos.ticker}</b> ${pos.side} ${pos.leverage}x — Einsatz ${usd(pos.stake)}
    ${pnl === null ? "" : `<span class="${pnl >= 0 ? "pnl-pos" : "pnl-neg"}">P&amp;L ${usd(pnl)}</span>`}
    <div class="meta">Entry ${pos.entryPrice} · SL ${pos.stopLoss}${pos.takeProfit ? ` · TP ${pos.takeProfit}` : ""}
      · Wake ${pos.wakeBelow ?? "—"}/${pos.wakeAbove ?? "—"}</div>
    <div class="meta">${pos.thesis ?? ""}</div>
    <div class="chart"></div>`;
  return el;
}

async function drawTickerChart(container, pos) {
  const series = await api(`/api/ticks?ticker=${pos.ticker}`);
  if (series.length === 0) {
    container.innerHTML = '<span class="empty">Noch keine Tick-Historie — füllt sich ab dem nächsten Handelstag.</span>';
    return;
  }
  const chart = LightweightCharts.createChart(container, CHART_OPTS);
  const line = chart.addLineSeries({ color: "#e6e9ef", lineWidth: 2 });
  line.setData(series.map((p) => ({ time: ts(p.at), value: p.close })));
  priceLine(line, pos.entryPrice, "Entry", "#8b96a8");
  priceLine(line, pos.stopLoss, "SL", "#e0556a");
  priceLine(line, pos.takeProfit, "TP", "#3fb68b");
  priceLine(line, pos.wakeAbove, "Wake↑", "#caa75c");
  priceLine(line, pos.wakeBelow, "Wake↓", "#caa75c");
  chart.timeScale().fitContent();
}

function renderJournal(md) {
  const entries = md.split(/\n## /).slice(1).reverse();
  if (entries.length === 0) {
    $("#journal").innerHTML = '<span class="empty">Noch keine Einträge.</span>';
    return;
  }
  $("#journal").innerHTML = entries
    .map((e) => {
      const [head, ...body] = e.split("\n");
      return `<article><h3>${head}</h3><pre>${body.join("\n").trim()}</pre></article>`;
    })
    .join("");
}

async function load() {
  const state = await api("/api/state");
  const { portfolio } = state;
  const quotes = portfolio.lastTick?.quotes ?? {};

  $("#headline").innerHTML =
    `Equity <b>${usd(state.equity)}</b> · frei <b>${usd(portfolio.balance)}</b>` +
    ` · ${portfolio.positions.length} Positionen, ${portfolio.orders.length} Orders` +
    (state.generatedAt ? ` · Stand ${new Date(state.generatedAt).toLocaleString("de-DE")}` : "");

  const posRoot = $("#positions");
  posRoot.innerHTML = portfolio.positions.length ? "" : '<span class="empty">keine</span>';
  for (const pos of portfolio.positions) {
    const card = positionCard(pos, quotes);
    posRoot.appendChild(card);
    drawTickerChart(card.querySelector(".chart"), pos).catch(console.error);
  }

  const orderRoot = $("#orders");
  orderRoot.innerHTML = portfolio.orders.length ? "" : '<span class="empty">keine</span>';
  for (const o of portfolio.orders) {
    const el = document.createElement("div");
    el.className = "card";
    el.innerHTML = `<b>${o.ticker}</b> ${o.side} ${o.leverage}x — ${o.entryType === "market" ? "Market" : `Limit ${o.limitPrice}`},
      SL ${o.stopLoss}${o.takeProfit ? `, TP ${o.takeProfit}` : ""} <div class="meta">${o.thesis ?? ""}</div>`;
    orderRoot.appendChild(el);
  }

  const eq = await api("/api/equity");
  if (eq.length > 1) {
    const chart = LightweightCharts.createChart($("#equity-chart"), CHART_OPTS);
    const line = chart.addAreaSeries({ lineColor: "#3fb68b", topColor: "rgba(63,182,139,.25)", bottomColor: "transparent" });
    line.setData(eq.map((p) => ({ time: ts(p.at), value: p.equity })));
    chart.timeScale().fitContent();
  } else {
    $("#equity-section").querySelector(".chart").innerHTML = '<span class="empty">Noch keine abgeschlossenen Trades.</span>';
  }

  renderJournal(await api("/api/journal", true));
}

load().catch((err) => { $("#headline").textContent = `Fehler: ${err.message}`; });
setInterval(() => location.reload(), 5 * 60 * 1000); // refresh with the monitor-tick cadence
