// src/ui/public/liveChart.js — pure config for the per-position TradingView
// Advanced-Chart embed (the live ~1-min view, ADR 0004 follow-up). Browser-native
// ESM (no DOM access here); imported by app.js and exercised by vitest.
//
// The embed runs in a sandboxed TradingView iframe, so our own price lines
// (Entry/SL/TP/Wake) CANNOT be drawn on it — those stay in the legend bar and on
// the 5-min tick chart. This widget is the live blick only; it loads lazily, on
// demand, because each one is a separate iframe.

/** Loader script for the Advanced-Chart embed widget. */
export const TV_EMBED_SRC =
  "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";

/**
 * Normalise a bare depot ticker to a TradingView symbol. Bare US symbols
 * resolve on TradingView's side; an already-qualified "EXCHANGE:SYM" passes
 * through (upper-cased). Nullish input degrades to "".
 */
export function tvSymbol(ticker) {
  return String(ticker ?? "").trim().toUpperCase();
}

/**
 * Config object for the Advanced-Chart embed: 1-minute candles, dark theme,
 * German locale, Berlin timezone, read-only (no symbol change, no image save).
 * The background matches the UI's --bg so the iframe blends into the card.
 */
export function tvWidgetConfig(ticker) {
  return {
    autosize: true,
    symbol: tvSymbol(ticker),
    interval: "1", // 1-minute bars — the live cadence the 5-min tick chart can't give
    timezone: "Europe/Berlin",
    theme: "dark",
    style: "1", // candles
    locale: "de",
    hide_side_toolbar: true,
    allow_symbol_change: false,
    save_image: false,
    backgroundColor: "rgba(17, 21, 28, 1)", // --bg
  };
}
