// Depot-UI frontend (read-only). LightweightCharts is loaded globally via
// /vendor/lightweight-charts.js (v4 standalone build).
import { buildLegend } from "./legend.js";

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

function legendBar(pos, quotes) {
  const model = buildLegend(pos, quotes[pos.ticker]?.close);
  const fmtPx = (n) => (n === null ? "—" : n.toFixed(2));
  const fmtPct = (p) => (p === null ? "" : ` (${p >= 0 ? "+" : ""}${p.toFixed(1)}%)`);
  const cell = (label, px, pct, tone) =>
    `<span class="leg-cell leg-${tone}"><span class="leg-k">${label}</span> ${fmtPx(px)}${fmtPct(pct)}</span>`;
  const cells = [
    cell("Kurs", model.price, null, "px"),
    ...model.rows.map((r) => cell(r.label, r.price, r.pct, r.tone)),
  ];
  return `<div class="legend">${cells.join("")}</div>`;
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
    <div class="meta">${pos.thesis ?? ""}</div>
    ${legendBar(pos, quotes)}
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

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function renderKuerArtifact(a) {
  const debates = a.debate?.debates ?? [];
  const cards = (a.dossier?.candidates ?? []).map((c) => {
    const d = debates.find((x) => x.ticker === c.ticker);
    return `<div class="card">
      <b>${esc(c.ticker)}</b> — ${esc(c.angle)}
      <div class="meta">Katalysator: ${esc(c.catalyst)} · Sentiment: ${esc(c.sentiment)}</div>
      ${d ? `<div class="bullbear"><div><b class="pnl-pos">Bull</b><br>${esc(d.bull)}</div><div><b class="pnl-neg">Bear</b><br>${esc(d.bear)}</div></div>` : ""}
    </div>`;
  });
  const orders = a.orders.map(
    (o) => `<div class="card"><b>${esc(o.ticker)}</b> ${o.side} ${o.leverage}x — Einsatz ${usd(o.stake)},
      ${o.entryType === "market" ? "Market" : `Limit ${o.limitPrice}`}, SL ${o.stopLoss}${o.takeProfit ? `, TP ${o.takeProfit}` : ""}
      <div class="meta">${esc(o.thesis)}</div></div>`,
  );
  const rejected = a.rejected.map((r) => `<div class="meta">✗ ${esc(r.ticker)} ${r.side} — ${esc(r.reason)}</div>`);
  return [
    a.dossier ? "" : '<p class="empty">Research fehlgeschlagen — entschieden auf Scan-Basis.</p>',
    cards.join(""),
    a.dossier && !a.debate ? '<p class="empty">Keine Debatte verfügbar.</p>' : "",
    a.status === "skipped-unreadable"
      ? '<p class="empty">Entscheidung unlesbar — keine Trades an diesem Tag.</p>'
      : `<article><h3>Mr Apes Begründung</h3><pre>${esc(a.decisionJournal ?? "")}</pre></article>`,
    orders.length ? `<h3>Platzierte Orders</h3>${orders.join("")}` : a.status === "decided" ? '<p class="empty">Keine Orders platziert.</p>' : "",
    rejected.length ? `<h3>Abgelehnt</h3>${rejected.join("")}` : "",
    a.scanSummary ? `<details><summary>Scan-Kontext</summary><pre>${esc(a.scanSummary)}</pre></details>` : "",
  ].join("");
}

async function showKuerDay(day) {
  $("#kuer-detail").innerHTML = renderKuerArtifact(await api(`/api/kuer?day=${day}`));
}

async function renderKuerSection() {
  const days = await api("/api/kuer/days");
  if (days.length === 0) {
    $("#kuer").innerHTML = '<span class="empty">Noch keine Kür-Artefakte — entstehen ab der nächsten Kandidatenkür.</span>';
    return;
  }
  $("#kuer").innerHTML = `<select id="kuer-day">${days.map((d) => `<option>${d}</option>`).join("")}</select><div id="kuer-detail"></div>`;
  $("#kuer-day").onchange = (e) => showKuerDay(e.target.value).catch(console.error);
  await showKuerDay(days[0]);
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

  renderKuerSection().catch((err) => {
    $("#kuer").innerHTML = `<span class="empty">Kür-Ansicht nicht ladbar: ${esc(err.message)}</span>`;
  });
}

load().catch((err) => { $("#headline").textContent = `Fehler: ${err.message}`; });
setInterval(() => location.reload(), 5 * 60 * 1000); // refresh with the monitor-tick cadence
