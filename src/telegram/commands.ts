import { normalizeProfile, DEFAULT_PROFILE, type TradingProfile } from "../core/ape-intel";

export type Command =
  | { kind: "strategie"; ticker: string; profile: TradingProfile }
  | { kind: "scan" }
  | { kind: "journal"; text?: string }
  | { kind: "unknown"; text: string };

/** Parse a Telegram message into a typed command. Pure. */
export function parseCommand(text: string): Command {
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  const head = (parts[0] ?? "").toLowerCase().replace(/@.*$/, "");
  const rest = parts.slice(1);

  if (head === "/scan") return { kind: "scan" };

  if (head === "/journal") {
    const text = rest.join(" ").trim();
    return text === "" ? { kind: "journal" } : { kind: "journal", text };
  }

  if (head === "/strategie" || head === "/analyse") {
    const ticker = rest[0];
    if (!ticker) return { kind: "unknown", text: trimmed };
    // normalizeProfile silently drops invalid risk/horizon words -> defaults.
    const profile = normalizeProfile({ risk: rest[1], horizon: rest[2] });
    return { kind: "strategie", ticker: ticker.toUpperCase(), profile };
  }

  return { kind: "unknown", text: trimmed };
}

export { DEFAULT_PROFILE };
