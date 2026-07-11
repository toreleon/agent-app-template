"use client";

import { create } from "zustand";
import type {
  CreateProjectRequest,
  ProjectDetail,
  ProjectSummary,
  UpdateProjectRequest,
  UploadProjectFilesResponse,
} from "@/lib/types";

/** Read an { error } body from a failed Response, falling back to a default. */
async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* non-JSON body */
  }
  return fallback;
}

export interface ProjectState {
  // ---- data ----
  projects: ProjectSummary[];
  /** The project currently open on the detail page, or null. */
  detail: ProjectDetail | null;

  // ---- ui / status ----
  loading: boolean;
  detailLoading: boolean;
  /** True while a create/update/delete/upload mutation is in flight. */
  saving: boolean;
  error: string | null;

  // ---- actions ----
  load: () => Promise<void>;
  loadDetail: (id: string) => Promise<void>;
  create: (req: CreateProjectRequest) => Promise<ProjectSummary | null>;
  update: (
    id: string,
    patch: UpdateProjectRequest,
  ) => Promise<ProjectSummary | null>;
  remove: (id: string) => Promise<boolean>;
  uploadFiles: (id: string, files: File[]) => Promise<boolean>;
  removeFile: (id: string, fileId: string) => Promise<boolean>;
  clearError: () => void;
}

// Monotonic token for loadDetail so a slow response for a previously-requested
// project can never overwrite the detail of the project the user switched to.
let detailReqSeq = 0;

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  detail: null,
  loading: false,
  detailLoading: false,
  saving: false,
  error: null,

  clearError: () => set({ error: null }),

  load: async () => {
    set({ loading: true });
    try {
      const res = await fetch("/api/projects", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Failed to load projects"));
      const data = (await res.json()) as ProjectSummary[];
      set({ projects: data, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load projects" });
    } finally {
      set({ loading: false });
    }
  },

  loadDetail: async (id) => {
    const seq = ++detailReqSeq;
    // Clear stale detail when switching projects so the page never flashes the
    // previously-open project.
    set({ detailLoading: true, detail: get().detail?.id === id ? get().detail : null });
    try {
      const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
      // A newer loadDetail started while this one was in flight — drop this
      // (stale) response so it can't clobber the current project.
      if (seq !== detailReqSeq) return;
      if (res.status === 404) {
        set({ error: "Project not found", detail: null });
        return;
      }
      if (!res.ok) throw new Error(await readError(res, "Failed to load project"));
      const data = (await res.json()) as ProjectDetail;
      if (seq !== detailReqSeq) return;
      set({ detail: data, error: null });
    } catch (e) {
      if (seq !== detailReqSeq) return;
      set({ error: e instanceof Error ? e.message : "Failed to load project" });
    } finally {
      // Only the most-recent request owns the loading flag.
      if (seq === detailReqSeq) set({ detailLoading: false });
    }
  },

  create: async (req) => {
    set({ saving: true, error: null });
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to create project"));
      const created = (await res.json()) as ProjectSummary;
      await get().load();
      return created;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to create project" });
      return null;
    } finally {
      set({ saving: false });
    }
  },

  update: async (id, patch) => {
    // Optimistic merge in the list so edits feel instant; revert on failure.
    const prev = get().projects;
    const prevDetail = get().detail;
    set({
      saving: true,
      error: null,
      projects: prev.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      detail:
        prevDetail && prevDetail.id === id
          ? { ...prevDetail, ...patch }
          : prevDetail,
    });
    try {
      const res = await fetch(`/api/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to update project"));
      const updated = (await res.json()) as ProjectSummary;
      set((s) => ({
        projects: s.projects.map((p) => (p.id === id ? { ...p, ...updated } : p)),
        detail:
          s.detail && s.detail.id === id
            ? { ...s.detail, ...updated }
            : s.detail,
      }));
      return updated;
    } catch (e) {
      set({
        projects: prev,
        detail: prevDetail,
        error: e instanceof Error ? e.message : "Failed to update project",
      });
      return null;
    } finally {
      set({ saving: false });
    }
  },

  remove: async (id) => {
    const prev = get().projects;
    set({
      saving: true,
      error: null,
      projects: prev.filter((p) => p.id !== id),
      detail: get().detail?.id === id ? null : get().detail,
    });
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete project"));
      return true;
    } catch (e) {
      set({
        projects: prev,
        error: e instanceof Error ? e.message : "Failed to delete project",
      });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  uploadFiles: async (id, files) => {
    if (files.length === 0) return true;
    set({ saving: true, error: null });
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      const res = await fetch(`/api/projects/${id}/files`, {
        method: "POST",
        body: form,
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to upload files"));
      (await res.json()) as UploadProjectFilesResponse;
      // Refetch detail so file list + counts are canonical.
      await get().loadDetail(id);
      await get().load();
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to upload files" });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  removeFile: async (id, fileId) => {
    const prevDetail = get().detail;
    // Optimistically drop the file from the open detail.
    if (prevDetail && prevDetail.id === id) {
      set({
        detail: {
          ...prevDetail,
          files: prevDetail.files.filter((f) => f.id !== fileId),
          fileCount: Math.max(0, prevDetail.fileCount - 1),
        },
      });
    }
    set({ saving: true, error: null });
    try {
      const res = await fetch(`/api/projects/${id}/files/${fileId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to remove file"));
      await get().load();
      return true;
    } catch (e) {
      set({
        detail: prevDetail,
        error: e instanceof Error ? e.message : "Failed to remove file",
      });
      return false;
    } finally {
      set({ saving: false });
    }
  },
}));
