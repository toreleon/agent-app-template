import type { StreamEvent } from "@/lib/types";

/**
 * Parse a `text/event-stream` Response body into a stream of {@link StreamEvent}.
 *
 * Wire format (see CONTRACTS §5): each event is a single SSE message of the form
 * `data: <json>\n\n`. We split on the blank-line delimiter, strip the leading
 * `data:` prefix and JSON-parse the remainder. Empty segments and non-`data:`
 * lines (e.g. `: ping` keep-alive comments) are ignored.
 */
export async function* parseSSE(res: Response): AsyncGenerator<StreamEvent> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const line = raw.trim();
        if (!line.startsWith("data:")) continue;
        const json = line.slice(line.indexOf(":") + 1).trim();
        if (!json) continue;
        try {
          yield JSON.parse(json) as StreamEvent;
        } catch {
          // Ignore malformed JSON chunks rather than aborting the whole stream.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
