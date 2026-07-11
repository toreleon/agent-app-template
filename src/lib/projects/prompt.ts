/**
 * Composes a project's custom instructions + knowledge files into the extra
 * system-prompt block injected for every chat that belongs to the project. The
 * chat route resolves a conversation's `projectId`, loads the project via
 * {@link loadProjectContext}, and passes the returned string to
 * `streamChat({ projectContext })`, which appends it to the base INSTRUCTIONS.
 *
 * Knowledge is capped at {@link MAX_PROJECT_KNOWLEDGE_CHARS} total characters so
 * a large project can never blow the context window; files past the budget are
 * truncated or omitted with an explicit note.
 */
import type { PrismaClient } from "@prisma/client";
import { MAX_PROJECT_KNOWLEDGE_CHARS } from "@/lib/types";

/** The minimal project shape the composer needs. */
export interface ProjectPromptInput {
  name: string;
  instructions: string | null;
  files: Array<{ name: string; content: string | null }>;
}

/**
 * Build the system-prompt block for a project, or null when there is nothing to
 * inject (no instructions and no readable knowledge). Pure and deterministic.
 */
export function composeProjectContext(project: ProjectPromptInput): string | null {
  const instructions = (project.instructions ?? "").trim();
  const knowledgeFiles = project.files.filter(
    (f) => typeof f.content === "string" && f.content.trim().length > 0,
  );

  if (!instructions && knowledgeFiles.length === 0) return null;

  const parts: string[] = [];
  parts.push(
    `This conversation belongs to the user's project "${project.name}". ` +
      `Keep the project's goal and instructions in mind across the whole conversation, ` +
      `and treat the attached project knowledge as authoritative reference for this project ` +
      `(prefer it over general assumptions, and mention which file you used when it helps).`,
  );

  if (instructions) {
    parts.push(`Project instructions:\n${instructions}`);
  }

  if (knowledgeFiles.length > 0) {
    let budget = MAX_PROJECT_KNOWLEDGE_CHARS;
    const rendered: string[] = [];
    const omitted: string[] = [];

    for (const file of knowledgeFiles) {
      const body = (file.content ?? "").trim();
      if (budget <= 0) {
        omitted.push(file.name);
        continue;
      }
      let slice = body;
      let truncated = false;
      if (slice.length > budget) {
        slice = slice.slice(0, budget);
        truncated = true;
      }
      budget -= slice.length;
      rendered.push(
        `----- BEGIN FILE: ${file.name} -----\n${slice}${
          truncated ? "\n…[truncated]" : ""
        }\n----- END FILE: ${file.name} -----`,
      );
    }

    let knowledge = `Project knowledge files:\n\n${rendered.join("\n\n")}`;
    if (omitted.length > 0) {
      knowledge += `\n\n(Omitted for length: ${omitted.join(", ")}.)`;
    }
    parts.push(knowledge);
  }

  return `=== Project context ===\n${parts.join("\n\n")}\n=== End project context ===`;
}

/**
 * Load a project by id (no ownership check — the caller has already resolved the
 * conversation it owns) and compose its system-prompt context. Returns null when
 * `projectId` is null/unknown or the project has nothing to inject. Never throws:
 * a DB error degrades to null so chat is never broken by project loading.
 */
export async function loadProjectContext(
  prisma: PrismaClient,
  projectId: string | null | undefined,
): Promise<string | null> {
  if (!projectId) return null;
  try {
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: {
        name: true,
        instructions: true,
        files: {
          orderBy: { createdAt: "asc" },
          select: { name: true, content: true },
        },
      },
    });
    if (!project) return null;
    return composeProjectContext({
      name: project.name,
      instructions: project.instructions,
      files: project.files,
    });
  } catch (err) {
    console.error("[projects] failed to load project context:", err);
    return null;
  }
}
