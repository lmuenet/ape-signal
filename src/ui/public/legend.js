// src/ui/public/legend.js — pure legend model for the depot UI position charts.
// Browser-native ESM (no DOM access here); imported by app.js and by vitest.
// "Schwellen" (TP/SL/Wake) carry a signed distance to the current price; Entry
// is a reference point shown without a percent. Missing values degrade to null.

export function distancePct(price, threshold) {
  if (typeof price !== "number" || price <= 0) return null;
  if (typeof threshold !== "number") return null;
  return ((threshold - price) / price) * 100;
}

export function buildLegend(pos, price) {
  const p = typeof price === "number" ? price : null;
  const row = (key, label, value, tone, withPct) => ({
    key,
    label,
    tone,
    price: typeof value === "number" ? value : null,
    pct: withPct ? distancePct(p, value) : null,
  });
  return {
    price: p,
    rows: [
      row("entry", "Entry", pos.entryPrice, "muted", false),
      row("tp", "TP", pos.takeProfit, "pos", true),
      row("wakeUp", "Wake↑", pos.wakeAbove, "wake", true),
      row("wakeDown", "Wake↓", pos.wakeBelow, "wake", true),
      row("sl", "SL", pos.stopLoss, "neg", true),
    ],
  };
}
