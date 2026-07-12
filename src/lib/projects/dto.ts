/**
 * Pure serializers mapping Prisma rows to the Projects wire DTOs. No database
 * access here — routes load the rows (with counts / relations) and hand them to
 * these functions, keeping date/enum coercion in one place. Mirrors the pattern
 * of src/lib/schedule/dto.ts.
 */
import type { Project, ProjectFile } from "@prisma/client";
import { toConversationSummary, type ConversationSummaryRow } from "@/lib/conversations";
import { isProjectIconName } from "@/lib/types";
import type {
  ProjectDetail,
  ProjectFileInfo,
  ProjectSummary,
} from "@/lib/types";

/** Serialize one ProjectFile row to its API info DTO (omits the raw content). */
export function toProjectFileInfo(file: ProjectFile): ProjectFileInfo {
  return {
    id: file.id,
    name: file.name,
    type: file.type,
    size: file.size,
    url: file.url,
    hasContent: typeof file.content === "string" && file.content.length > 0,
    createdAt: file.createdAt.toISOString(),
  };
}

/**
 * Serialize a Project row to its list/summary DTO. `conversationCount` and
 * `fileCount` are passed in (the route computes them via `_count` or a query),
 * defaulting to 0 so a freshly created project serializes cleanly.
 */
export function toProjectSummary(
  project: Project,
  counts: { conversations?: number; files?: number } = {},
): ProjectSummary {
  return {
    id: project.id,
    name: project.name,
    icon: isProjectIconName(project.icon) ? project.icon : "folder",
    description: project.description,
    instructions: project.instructions,
    conversationCount: counts.conversations ?? 0,
    fileCount: counts.files ?? 0,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

/**
 * Serialize a Project plus its knowledge files and member conversations. Files
 * and conversations are provided already ordered by the route; counts are
 * derived from their lengths.
 */
export function toProjectDetail(
  project: Project,
  files: ProjectFile[],
  conversations: ConversationSummaryRow[],
): ProjectDetail {
  return {
    ...toProjectSummary(project, {
      conversations: conversations.length,
      files: files.length,
    }),
    files: files.map(toProjectFileInfo),
    conversations: conversations.map(toConversationSummary),
  };
}
