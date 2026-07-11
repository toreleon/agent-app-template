"use client";

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText, Plus, Trash2, X } from "lucide-react";
import { MAX_PROJECT_FILES } from "@/lib/types";
import { useProjectStore } from "@/store/projects";
import { useChatStore } from "@/store/chat";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/components/ui/cn";
import { ProjectForm } from "./ProjectForm";

/** Human-readable byte size (e.g. "12.4 KB"). */
function humanizeBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export interface ProjectDetailProps {
  projectId: string;
}

/**
 * Full-screen client shell for a single project. Mirrors the SchedulesApp shell
 * (collapsible sidebar + content column) and renders the project's description,
 * editable instructions, knowledge files, and member conversations.
 */
export function ProjectDetail({ projectId }: ProjectDetailProps) {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const detail = useProjectStore((s) => s.detail);
  const detailLoading = useProjectStore((s) => s.detailLoading);
  const error = useProjectStore((s) => s.error);
  const loadDetail = useProjectStore((s) => s.loadDetail);
  const update = useProjectStore((s) => s.update);
  const remove = useProjectStore((s) => s.remove);
  const uploadFiles = useProjectStore((s) => s.uploadFiles);
  const removeFile = useProjectStore((s) => s.removeFile);
  const clearError = useProjectStore((s) => s.clearError);

  // The shared Sidebar reads the conversation list from the chat store; load it
  // here too so the left rail is populated when landing directly on a project.
  const loadConversations = useChatStore((s) => s.loadConversations);

  useEffect(() => {
    void loadDetail(projectId);
    void loadConversations();
  }, [projectId, loadDetail, loadConversations]);

  // ---- editable instructions ----
  const savedInstructions = detail?.instructions ?? "";
  const [instrValue, setInstrValue] = useState("");
  const [savingInstr, setSavingInstr] = useState(false);
  // Seed the editor from saved instructions only when the project itself
  // changes — NOT whenever detail.instructions changes. Otherwise a failed
  // optimistic save (which reverts detail.instructions) would silently wipe the
  // user's in-progress edit out of the textarea.
  const detailId = detail?.id;
  useEffect(() => {
    setInstrValue(detail?.instructions ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId]);

  async function saveInstructions() {
    setSavingInstr(true);
    await update(projectId, { instructions: instrValue.trim() || null });
    setSavingInstr(false);
  }

  // ---- knowledge files ----
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFilesPicked(e: ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    e.target.value = "";
    setUploading(true);
    await uploadFiles(projectId, files);
    setUploading(false);
  }

  async function handleDelete() {
    if (!detail) return;
    const confirmed = window.confirm(
      `Delete this project and its ${detail.conversationCount} chats? This cannot be undone.`,
    );
    if (!confirmed) return;
    const ok = await remove(projectId);
    if (ok) router.push("/projects");
  }

  return (
    <div className="flex h-screen w-full overflow-hidden bg-main">
      <div
        className={cn(
          "h-full shrink-0 overflow-hidden border-r border-border/60 transition-[width] duration-200",
          sidebarOpen ? "w-[260px]" : "w-[52px]",
        )}
      >
        <Sidebar open={sidebarOpen} onToggle={() => setSidebarOpen((o) => !o)} />
      </div>

      <div className="flex h-full min-w-0 flex-1 flex-col">
        {error && (
          <div className="mx-auto mt-1 flex w-full max-w-3xl items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">
            <span className="truncate">{error}</span>
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={clearError}
              className="shrink-0 text-red-300 hover:text-red-200"
            >
              <X size={16} />
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {detailLoading && !detail ? (
              <div className="flex items-center justify-center py-20 text-text-secondary">
                <Spinner size={22} />
              </div>
            ) : !detail ? (
              <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 py-16 text-center">
                <h2 className="text-base font-semibold text-text-primary">
                  Project not found
                </h2>
                <Link
                  href="/projects"
                  className="mt-2 text-sm text-accent hover:underline"
                >
                  Back to projects
                </Link>
              </div>
            ) : (
              <>
                {/* Header */}
                <header className="flex h-12 items-center gap-2">
                  <IconButton
                    label="Back to projects"
                    onClick={() => router.push("/projects")}
                  >
                    <ArrowLeft size={18} />
                  </IconButton>
                  <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-text-primary">
                    {detail.name}
                  </h1>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFormOpen(true)}
                  >
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={handleDelete}>
                    <Trash2 size={15} /> Delete
                  </Button>
                </header>

                <div className="mt-4 flex flex-col gap-4">
                  {/* Description */}
                  <section className="rounded-2xl border border-border p-5">
                    <h2 className="text-sm font-semibold text-text-primary">
                      Description
                    </h2>
                    {detail.description ? (
                      <p className="mt-2 whitespace-pre-wrap text-sm text-text-primary">
                        {detail.description}
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-text-secondary">
                        No description
                      </p>
                    )}
                  </section>

                  {/* Instructions */}
                  <section className="rounded-2xl border border-border p-5">
                    <h2 className="text-sm font-semibold text-text-primary">
                      Instructions
                    </h2>
                    <p className="mt-1 text-xs text-text-secondary">
                      These custom instructions are added to the system prompt for
                      every chat in this project.
                    </p>
                    <textarea
                      value={instrValue}
                      onChange={(e) => setInstrValue(e.target.value)}
                      rows={6}
                      placeholder="How should the assistant behave in this project?"
                      className="mt-3 w-full resize-y rounded-lg border border-border bg-main px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary focus:border-text-secondary focus:outline-none"
                    />
                    <div className="mt-3 flex justify-end">
                      <Button
                        size="sm"
                        onClick={saveInstructions}
                        disabled={instrValue === savedInstructions}
                        loading={savingInstr}
                      >
                        Save
                      </Button>
                    </div>
                  </section>

                  {/* Knowledge */}
                  <section className="rounded-2xl border border-border p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-text-primary">
                        Knowledge ({detail.fileCount}/{MAX_PROJECT_FILES})
                      </h2>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleFilesPicked}
                        tabIndex={-1}
                        aria-hidden="true"
                      />
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={
                          uploading || detail.fileCount >= MAX_PROJECT_FILES
                        }
                        loading={uploading}
                      >
                        <Plus size={16} /> Add files
                      </Button>
                    </div>
                    <p className="mt-1 text-xs text-text-secondary">
                      Text is extracted from PDFs, text, Markdown, CSV, and JSON and
                      shared with every chat.
                    </p>

                    {detail.files.length === 0 ? (
                      <p className="mt-3 text-sm text-text-secondary">
                        No files yet. Add PDFs, text, or Markdown to give every chat
                        in this project shared context.
                      </p>
                    ) : (
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {detail.files.map((file) => (
                          <li
                            key={file.id}
                            className="flex items-center gap-3 rounded-lg border border-border/60 bg-sidebar/40 px-3 py-2"
                          >
                            <FileText
                              size={16}
                              className="shrink-0 text-text-secondary"
                            />
                            <span className="min-w-0 flex-1 truncate text-sm text-text-primary">
                              {file.name}
                            </span>
                            {!file.hasContent && (
                              <span className="shrink-0 rounded-full bg-hover px-2 py-0.5 text-xs text-text-secondary">
                                Not indexed
                              </span>
                            )}
                            <span className="shrink-0 text-xs text-text-secondary tabular-nums">
                              {humanizeBytes(file.size)}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${file.name}`}
                              onClick={() => void removeFile(projectId, file.id)}
                              className="shrink-0 text-text-secondary transition-colors hover:text-red-400"
                            >
                              <Trash2 size={15} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>

                  {/* Chats */}
                  <section className="rounded-2xl border border-border p-5">
                    <div className="flex items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-text-primary">
                        Chats
                      </h2>
                      <Button
                        size="sm"
                        onClick={() => router.push(`/?project=${projectId}`)}
                      >
                        <Plus size={16} /> New chat
                      </Button>
                    </div>

                    {detail.conversations.length === 0 ? (
                      <p className="mt-3 text-sm text-text-secondary">
                        No chats yet. Start one to work inside this project.
                      </p>
                    ) : (
                      <ul className="mt-3 flex flex-col gap-0.5">
                        {detail.conversations.map((c) => (
                          <li key={c.id}>
                            <Link
                              href={`/c/${c.id}`}
                              className="block truncate rounded-lg px-3 py-2 text-sm text-text-primary transition-colors hover:bg-hover"
                              title={c.title}
                            >
                              {c.title}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ProjectForm
        open={formOpen}
        project={detail}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}

export default ProjectDetail;
