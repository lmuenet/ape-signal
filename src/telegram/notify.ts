// src/telegram/notify.ts — message verbosity gate. Every AUTONOMOUS Telegram
// message carries a category; TELEGRAM_VERBOSITY decides which categories are
// actually transmitted. The ape-ui journal keeps the FULL record regardless —
// this only mutes the chat. Default keeps the trade-lifecycle + the daily digest
// + risk/ops alerts, and mutes process progress + research/signal chatter.
export type NotifyCategory = "trade" | "digest" | "alert" | "progress" | "research";

/** A send function that also takes a category. Untagged sends default to "trade". */
export type Notify = (text: string, category?: NotifyCategory) => Promise<void> | void;

const ALL: readonly NotifyCategory[] = ["trade", "digest", "alert", "progress", "research"];
const DEFAULT_VERBOSITY: readonly NotifyCategory[] = ["trade", "digest", "alert"];

/**
 * Parse `TELEGRAM_VERBOSITY` into the set of enabled categories.
 * - unset / empty → the safe default (`trade,digest,alert`)
 * - `"all"` → every category
 * - otherwise a comma list (trimmed, case-insensitive); unknown tokens ignored,
 *   and if nothing valid remains we fall back to the default (never silence).
 */
export function parseVerbosity(raw: string | undefined): Set<NotifyCategory> {
  if (raw === undefined || raw.trim() === "") return new Set(DEFAULT_VERBOSITY);
  const tokens = raw.split(",").map((t) => t.trim().toLowerCase());
  if (tokens.includes("all")) return new Set(ALL);
  const picked = tokens.filter((t): t is NotifyCategory => (ALL as readonly string[]).includes(t));
  return picked.length > 0 ? new Set(picked) : new Set(DEFAULT_VERBOSITY);
}

/**
 * Wrap a raw text sender so only enabled categories are transmitted. An untagged
 * message counts as `"trade"` (always-on by default). A suppressed message
 * resolves to `undefined` (no send, no throw) so callers can `await` it safely.
 */
export function createNotifier(
  send: (text: string) => Promise<void> | void,
  allowed: Set<NotifyCategory>,
): Notify {
  return (text: string, category: NotifyCategory = "trade") =>
    allowed.has(category) ? send(text) : undefined;
}
