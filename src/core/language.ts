/**
 * Prompt-Direktiven, die an die Export-/Persona-Prompts angehängt werden, damit
 * Claude (a) Freitexte in der konfigurierten Sprache schreibt OHNE die
 * JSON-Parser zu brechen und (b) headless korrekt läuft (keine Tools, nur JSON).
 *
 * Ansatz "Direktiven-Overlay": Der Prompt-Körper bleibt deutsch; gewechselt wird
 * nur das Sprach-LABEL ({@link FREETEXT_LABEL}). Für `de` ist das Ergebnis
 * identisch zum bisherigen Verhalten. JSON-Schlüssel + Enums bleiben in JEDER
 * Sprache englisch (die Parser in decision.ts / ape-intel.ts verlangen das).
 */
export type Language = "de" | "en";

export const SUPPORTED_LANGUAGES: readonly Language[] = ["de", "en"];

/** Label, mit dem die (deutschsprachigen) Direktiven die Zielsprache benennen. */
const FREETEXT_LABEL: Record<Language, string> = { de: "DEUTSCH", en: "ENGLISCH" };

/** Das Sprach-Label für die Direktiven. Neue Sprache = ein Eintrag mehr oben. */
export function freetextLabel(lang: Language): string {
  return FREETEXT_LABEL[lang];
}

export function strategyDirective(lang: Language = "de"): string {
  return [
    `WICHTIG — SPRACHE: Schreibe ALLE Freitext-Inhalte auf ${FREETEXT_LABEL[lang]} — auch die JSON-Werte`,
    "(recommendation, rationale, risks, barometerCritique, timeframe, instruments,",
    "positionSizing, targetPrice, stopLoss, leverage). Die JSON-Schlüssel bleiben exakt",
    "wie vorgegeben auf ENGLISCH. Für \"direction\" verwende weiterhin genau einen Wert aus",
    "long | short | stay-out, für \"conviction\" genau low | medium | high (NICHT übersetzen).",
  ].join("\n");
}

export function trendingDirective(lang: Language = "de"): string {
  return [
    `WICHTIG — SPRACHE: Schreibe \"summary\", \"thesis\" und \"watch\" auf ${FREETEXT_LABEL[lang]}.`,
    "Der Wert von \"verdict\" MUSS auf Englisch bleiben — exakt einer von:",
    "signal | noise | watch (sonst kann ich die Antwort nicht verarbeiten).",
    "Die JSON-Schlüssel bleiben Englisch.",
  ].join("\n");
}

export const HEADLESS_JSON_DIRECTIVE = [
  "WICHTIG — AUSFÜHRUNGSMODUS (headless): Dieser Aufruf läuft vollautomatisch ohne Tools",
  "und ohne interaktive Eingabe. Nutze KEINE Tools (kein WebSearch, WebFetch, Bash o.ä.),",
  "frage NICHT nach Berechtigungen und warte auf keine Bestätigung. Fehlt dir Live-Recherche,",
  "arbeite mit deinem vorhandenen Wissen weiter und vermerke die Unsicherheit IM Text —",
  "brich NICHT ab und stelle KEINE Rückfragen. Gib AUSSCHLIESSLICH den oben geforderten",
  "JSON-Block zurück — ohne Vorrede, ohne Nachsatz, ohne Rückfrage.",
].join("\n");
