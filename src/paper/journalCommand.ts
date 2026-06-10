// src/paper/journalCommand.ts — the Telegram /journal command. Without text:
// depot status + the latest journal entries. With text: Sonnet interprets the
// message as an admin instruction (set_balance/deposit/withdraw/note) and the
// engine applies it — the LLM never edits numbers itself.
import { adminAdjust } from "./engine";
import { renderPortfolio } from "./format";
import { buildAdminPrompt } from "./prompts";
import { parseAdminAction } from "./decision";
import type { Portfolio, QuoteMap } from "./types";

export interface JournalDeps {
  loadPortfolio: () => Portfolio;
  savePortfolio: (p: Portfolio) => void;
  appendJournal: (title: string, body: string) => void;
  readJournalTail: () => string;
  fetchQuotes: (tickers: string[]) => Promise<QuoteMap>;
  /** Sonnet runner for the admin interpretation. */
  claudeRunner: (prompt: string) => Promise<string>;
}

const STATUS_TAIL_CHARS = 1500;

/** Handle /journal [freitext]; returns the Telegram reply text. */
export async function runJournalCommand(text: string | undefined, deps: JournalDeps): Promise<string> {
  const portfolio = deps.loadPortfolio();

  if (text === undefined || text.trim() === "") {
    let quotes: QuoteMap = {};
    const tickers = [...new Set(portfolio.positions.map((p) => p.ticker))];
    if (tickers.length > 0) {
      try {
        quotes = await deps.fetchQuotes(tickers);
      } catch {
        // Status still renders; positions show "Kurs fehlt".
      }
    }
    const tail = deps.readJournalTail().slice(-STATUS_TAIL_CHARS).trim();
    return [
      "🦍 Mr Ape — Depot",
      "",
      renderPortfolio(portfolio, quotes),
      "",
      "— Journal (Auszug) —",
      tail === "" ? "(noch leer)" : tail,
    ].join("\n");
  }

  const raw = await deps.claudeRunner(buildAdminPrompt(text, portfolio.balance));
  const parsed = parseAdminAction(raw);
  if (!parsed) {
    return "⚠️ Konnte die Anweisung nicht eindeutig interpretieren — Guthaben unverändert. Beispiel: \"setz dein Guthaben auf 500\" oder \"ich lege dir 200 dazu\".";
  }

  const updated = adminAdjust(portfolio, parsed.action);
  deps.savePortfolio(updated);
  const note = parsed.note.trim() !== "" ? parsed.note.trim() : `Anweisung: "${text}"`;
  deps.appendJournal("Verwaltung", note);

  if (parsed.action.action === "note") {
    return `📝 Notiert. (Guthaben unverändert: $${updated.balance.toFixed(2)})`;
  }
  const verb = { set_balance: "gesetzt", deposit: "eingezahlt", withdraw: "entnommen" }[parsed.action.action];
  return `✅ ${verb}: $${parsed.action.amount.toFixed(2)} — freies Guthaben jetzt $${updated.balance.toFixed(2)}.`;
}
