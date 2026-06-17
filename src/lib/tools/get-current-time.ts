import { tool } from "@openai/agents";
import { z } from "zod";

/**
 * A small utility tool that returns the current date and time. Useful for the
 * agent to answer "what time is it?" / "what's today's date?" style questions
 * without hallucinating, and to compute relative dates.
 */
export const getCurrentTimeTool = tool({
  name: "get_current_time",
  description:
    "Get the current date and time. Optionally format it for a specific IANA " +
    "time zone (e.g. 'America/New_York', 'Europe/London', 'UTC'). Use this " +
    "whenever the user asks about the current time, today's date, or needs a " +
    "relative date computed.",
  parameters: z.object({
    timeZone: z
      .string()
      .nullable()
      .describe(
        "Optional IANA time zone name, e.g. 'UTC' or 'America/Los_Angeles'. " +
          "Pass null to use UTC.",
      ),
  }),
  async execute({ timeZone }) {
    const now = new Date();
    const zone = timeZone && timeZone.trim() ? timeZone.trim() : "UTC";

    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        dateStyle: "full",
        timeStyle: "long",
      });
      return {
        iso: now.toISOString(),
        timeZone: zone,
        formatted: formatter.format(now),
        unixSeconds: Math.floor(now.getTime() / 1000),
      };
    } catch {
      // Invalid time zone: fall back to UTC rather than throwing.
      return {
        iso: now.toISOString(),
        timeZone: "UTC",
        formatted: now.toUTCString(),
        unixSeconds: Math.floor(now.getTime() / 1000),
        note: `Unknown time zone "${zone}"; returned UTC instead.`,
      };
    }
  },
});
