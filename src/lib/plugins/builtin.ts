import type { SkillListItem } from "@/lib/types";

/**
 * Built-in commands ship WITH the app (not user-installed) and surface in the
 * composer's `/` slash menu alongside installed skills — the app's own
 * "built-in plugin". Unlike a plugin skill, a built-in command is NOT loaded
 * via the `skill` tool: the chat route detects it and switches behavior. The
 * first (and currently only) one is Deep Research, which runs the research
 * pipeline (clarify → plan → search → cited report) instead of a normal turn.
 */
export interface BuiltinCommand {
  /** Slash-command name — the `/name` the user types and the menu label. */
  name: string;
  description: string;
  /** Argument hint shown after the command in the menu (e.g. "[question]"). */
  argumentHint?: string;
}

/** The "source" label shown for built-in commands in the slash menu. */
export const BUILTIN_PLUGIN_LABEL = "Built-in";

/** The Deep Research command name (single source of truth for the route check). */
export const DEEP_RESEARCH_COMMAND = "deep-research";

export const BUILTIN_COMMANDS: BuiltinCommand[] = [
  {
    name: DEEP_RESEARCH_COMMAND,
    description:
      "Research a question across many web sources and write a cited report — " +
      "asks a few clarifying questions first, then plans, searches, and synthesizes.",
    argumentHint: "[question]",
  },
];

/** The built-in commands as slash-menu items (SkillListItem shape). */
export function builtinSkillItems(): SkillListItem[] {
  return BUILTIN_COMMANDS.map((c) => ({
    name: c.name,
    description: c.description,
    plugin: BUILTIN_PLUGIN_LABEL,
    argumentHint: c.argumentHint,
  }));
}

/**
 * Match a leading built-in command in a message. Returns the matched command +
 * the remaining argument text (trimmed), or null when the message doesn't start
 * with a known built-in command. Same `/token` grammar as the skill slash
 * command (leading alphanumeric, then [A-Za-z0-9_-]).
 */
export function matchBuiltinCommand(
  message: string,
): { command: BuiltinCommand; rest: string } | null {
  const m = /^\/([A-Za-z0-9][A-Za-z0-9_-]*)(?:\s+([\s\S]*))?$/.exec(message.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  const command = BUILTIN_COMMANDS.find((c) => c.name === name);
  if (!command) return null;
  return { command, rest: (m[2] ?? "").trim() };
}
