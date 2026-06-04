/**
 * Prompt directives appended to the export prompts so Claude (a) answers in
 * German WITHOUT breaking the JSON parsers, and (b) behaves correctly under a
 * headless `claude -p` run (no tools, no permission prompts, JSON only).
 *
 * The parsers require English tokens (parseTrendingChallenge: verdict ∈
 * {signal,noise,watch}; parseStrategy: fixed English keys) — only free text
 * becomes German.
 */
export const GERMAN_DIRECTIVE_STRATEGY = [
  "WICHTIG — SPRACHE: Schreibe ALLE Freitext-Inhalte auf DEUTSCH — auch die JSON-Werte",
  "(recommendation, rationale, risks, barometerCritique, timeframe, instruments,",
  "positionSizing, targetPrice, stopLoss, leverage). Die JSON-Schlüssel bleiben exakt",
  "wie vorgegeben auf ENGLISCH. Für \"direction\" verwende weiterhin genau einen Wert aus",
  "long | short | stay-out, für \"conviction\" genau low | medium | high (NICHT übersetzen).",
].join("\n");

export const GERMAN_DIRECTIVE_TRENDING = [
  "WICHTIG — SPRACHE: Schreibe \"summary\", \"thesis\" und \"watch\" auf DEUTSCH.",
  "Der Wert von \"verdict\" MUSS auf Englisch bleiben — exakt einer von:",
  "signal | noise | watch (sonst kann ich die Antwort nicht verarbeiten).",
  "Die JSON-Schlüssel bleiben Englisch.",
].join("\n");

export const HEADLESS_JSON_DIRECTIVE = [
  "WICHTIG — AUSFÜHRUNGSMODUS (headless): Dieser Aufruf läuft vollautomatisch ohne Tools",
  "und ohne interaktive Eingabe. Nutze KEINE Tools (kein WebSearch, WebFetch, Bash o.ä.),",
  "frage NICHT nach Berechtigungen und warte auf keine Bestätigung. Fehlt dir Live-Recherche,",
  "arbeite mit deinem vorhandenen Wissen weiter und vermerke die Unsicherheit IM Text —",
  "brich NICHT ab und stelle KEINE Rückfragen. Gib AUSSCHLIESSLICH den oben geforderten",
  "JSON-Block zurück — ohne Vorrede, ohne Nachsatz, ohne Rückfrage.",
].join("\n");
