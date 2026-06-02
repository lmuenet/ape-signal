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

export interface TelegramClient {
  sendMessage(text: string): Promise<void>;
}

export function createTelegramClient(
  config: TelegramConfig,
  fetchFn: typeof fetch = fetch,
): TelegramClient {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  return {
    async sendMessage(text: string): Promise<void> {
      for (const chunk of splitMessage(text)) {
        const res = await fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: config.chatId, text: chunk }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
        if (!res.ok || data.ok === false) {
          throw new Error(`Telegram sendMessage failed: ${data.description ?? res.status}`);
        }
      }
    },
  };
}
