import { tool } from "@openai/agents";
import { webSearchTool } from "@openai/agents";
import { z } from "zod";

/**
 * The OpenAI hosted web-search tool. When the agent runs against the OpenAI
 * Responses API this is executed server-side by OpenAI and returns rich,
 * citation-backed results. It serializes as the OpenAI `web_search_preview`
 * tool type and is only registered for the public OpenAI endpoint — see the
 * `OPENAI_BASE_URL` gating in src/lib/tools/index.ts.
 */
export const hostedWebSearchTool = webSearchTool();

/**
 * A dependency-free fallback web search implemented with `fetch` against the
 * DuckDuckGo Instant Answer API. This is used as a local function tool so the
 * agent still has *some* search capability even when the hosted tool is not
 * available or returns nothing useful. Results are intentionally lightweight.
 */
export const fallbackWebSearchTool = tool({
  name: "web_search_fallback",
  description:
    "Search the web for up-to-date information using a lightweight public " +
    "search API. Use this when you need recent facts, current events, or " +
    "information that may be newer than your training data. Returns a short " +
    "abstract and related links. Prefer the primary web search when available.",
  parameters: z.object({
    query: z.string().describe("The search query."),
  }),
  async execute({ query }) {
    const q = query.trim();
    if (!q) {
      return { ok: false, error: "Empty query." };
    }

    try {
      const url =
        "https://api.duckduckgo.com/?" +
        new URLSearchParams({
          q,
          format: "json",
          no_redirect: "1",
          no_html: "1",
          skip_disambig: "1",
        }).toString();

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      let res: Response;
      try {
        res = await fetch(url, {
          signal: controller.signal,
          headers: { "User-Agent": "chatgpt-clone/1.0 (web_search tool)" },
        });
      } finally {
        clearTimeout(timer);
      }

      if (!res.ok) {
        return {
          ok: false,
          error: `Search request failed with status ${res.status}.`,
        };
      }

      const data = (await res.json()) as {
        AbstractText?: string;
        AbstractURL?: string;
        Heading?: string;
        Answer?: string;
        Definition?: string;
        DefinitionURL?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };

      const related = (data.RelatedTopics ?? [])
        .filter((t) => t && t.Text && t.FirstURL)
        .slice(0, 5)
        .map((t) => ({ text: t.Text as string, url: t.FirstURL as string }));

      const abstract =
        data.AbstractText || data.Answer || data.Definition || "";

      if (!abstract && related.length === 0) {
        return {
          ok: true,
          query: q,
          abstract: "",
          results: [],
          note:
            "No instant answer found. The query may need a more specific " +
            "search engine; summarize from your own knowledge if appropriate.",
        };
      }

      return {
        ok: true,
        query: q,
        heading: data.Heading ?? null,
        abstract,
        abstractUrl: data.AbstractURL || data.DefinitionURL || null,
        results: related,
      };
    } catch (err) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? `Search failed: ${err.message}`
            : "Search failed.",
      };
    }
  },
});
