export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

const TELEGRAM_LIMIT = 4096;

/** Split text into chunks <= limit, breaking on newlines, preserving content. */
export function splitMessage(text: string, limit: number = TELEGRAM_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const candidate = current === "" ? line : `${current}\n${line}`;
    if (candidate.length <= limit) {
      current = candidate;
    } else {
      if (current !== "") chunks.push(current);
      // A single over-long line is hard-split.
      if (line.length <= limit) {
        current = line;
      } else {
        for (let i = 0; i < line.length; i += limit) chunks.push(line.slice(i, i + limit));
        current = "";
      }
    }
  }
  if (current !== "") chunks.push(current);
  return chunks;
}

export interface SendOptions {
  parseMode?: "HTML" | "MarkdownV2";
}

export interface TelegramClient {
  sendMessage(text: string, opts?: SendOptions): Promise<void>;
}

export function createTelegramClient(
  config: TelegramConfig,
  fetchFn: typeof fetch = fetch,
): TelegramClient {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  return {
    // NOTE on parseMode + splitMessage: chunks are split on newlines and each is
    // sent with the same parse_mode. Callers using "HTML" must keep any multi-line
    // tag block (e.g. <pre>) small and near the top so it always lands wholly in
    // the first chunk — a split must never bisect an open tag. The /strategie card
    // satisfies this (tiny <pre> box on top; flowing text uses per-line <b>…</b>).
    async sendMessage(text: string, opts: SendOptions = {}): Promise<void> {
      for (const chunk of splitMessage(text)) {
        const body: Record<string, unknown> = { chat_id: config.chatId, text: chunk };
        if (opts.parseMode) body.parse_mode = opts.parseMode;
        const res = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
        if (!res.ok || data.ok === false) {
          throw new Error(`Telegram sendMessage failed: ${data.description ?? res.status}`);
        }
      }
    },
  };
}
