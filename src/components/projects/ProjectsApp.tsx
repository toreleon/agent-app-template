"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, FolderKanban, MessageSquare, Plus, X } from "lucide-react";
import { useProjectStore } from "@/store/projects";
import { useChatStore } from "@/store/chat";
import { Sidebar } from "@/components/sidebar/Sidebar";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { cn } from "@/components/ui/cn";
import { ProjectForm } from "./ProjectForm";

/**
 * Top-level client app for the /projects route. Mirrors the ChatApp shell
 * (collapsible sidebar + content column) so navigation between chats and
 * projects feels seamless, then renders the project grid, empty state, error
 * banner, and the create modal.
 */
export function ProjectsApp() {
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const projects = useProjectStore((s) => s.projects);
  const loading = useProjectStore((s) => s.loading);
  const error = useProjectStore((s) => s.error);
  const load = useProjectStore((s) => s.load);
  const clearError = useProjectStore((s) => s.clearError);

  // The shared Sidebar reads the conversation list from the chat store; load it
  // here too so the left rail is populated when landing directly on /projects.
  const loadConversations = useChatStore((s) => s.loadConversations);

  useEffect(() => {
    void load();
    void loadConversations();
  }, [load, loadConversations]);

  const isEmpty = projects.length === 0;

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
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center justify-between gap-2 px-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <FolderKanban size={18} className="text-text-secondary" />
            Projects
          </div>
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus size={16} /> New project
          </Button>
        </header>

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

        {/* Main area */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6">
            {loading && isEmpty ? (
              <div className="flex items-center justify-center py-20 text-text-secondary">
                <Spinner size={22} />
              </div>
            ) : isEmpty ? (
              <EmptyState onCreate={() => setFormOpen(true)} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => router.push(`/projects/${p.id}`)}
                    className="flex flex-col rounded-2xl border border-border p-4 text-left transition-colors hover:bg-hover"
                  >
                    <div className="flex items-center gap-2">
                      <FolderKanban
                        size={16}
                        className="shrink-0 text-text-secondary"
                      />
                      <span className="min-w-0 truncate text-sm font-medium text-text-primary">
                        {p.name}
                      </span>
                    </div>
                    {p.description ? (
                      <p className="mt-1.5 line-clamp-2 text-sm text-text-secondary">
                        {p.description}
                      </p>
                    ) : (
                      <p className="mt-1.5 text-sm italic text-text-secondary/70">
                        No description
                      </p>
                    )}
                    <div className="mt-3 flex items-center gap-3 text-xs text-text-secondary">
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare size={12} />
                        {p.conversationCount} chats
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <FileText size={12} />
                        {p.fileCount} files
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <ProjectForm
        open={formOpen}
        project={null}
        onClose={() => setFormOpen(false)}
      />
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 py-16 text-center">
      <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-hover text-text-secondary">
        <FolderKanban size={24} />
      </span>
      <h2 className="text-base font-semibold text-text-primary">
        No projects yet
      </h2>
      <p className="mt-1 max-w-sm text-sm text-text-secondary">
        Group related conversations into a workspace with shared instructions
        and knowledge files that every chat can draw on.
      </p>
      <Button className="mt-5" size="sm" onClick={onCreate}>
        <Plus size={16} /> New project
      </Button>
    </div>
  );
}

export default ProjectsApp;
