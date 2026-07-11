"use client";

import { create } from "zustand";
import type { UpdateUserRequest, UserProfile } from "@/lib/types";

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* non-JSON */
  }
  return fallback;
}

export interface UserState {
  profile: UserProfile | null;
  loading: boolean;
  saving: boolean;
  error: string | null;
  load: () => Promise<void>;
  save: (patch: UpdateUserRequest) => Promise<boolean>;
  deleteAllChats: () => Promise<boolean>;
  logOutAllDevices: () => Promise<boolean>;
  deleteAccount: () => Promise<boolean>;
  exportData: () => Promise<boolean>;
  clearError: () => void;
}

export const useUserStore = create<UserState>((set, get) => ({
  profile: null,
  loading: false,
  saving: false,
  error: null,

  clearError: () => set({ error: null }),

  load: async () => {
    if (get().loading) return;
    set({ loading: true });
    try {
      const res = await fetch("/api/user", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Failed to load account"));
      set({ profile: (await res.json()) as UserProfile, error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to load account" });
    } finally {
      set({ loading: false });
    }
  },

  save: async (patch) => {
    set({ saving: true, error: null });
    try {
      const res = await fetch("/api/user", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error(await readError(res, "Failed to save"));
      set({ profile: (await res.json()) as UserProfile });
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to save" });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  deleteAllChats: async () => {
    set({ saving: true, error: null });
    try {
      const res = await fetch("/api/user/chats", { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete chats"));
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete chats" });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  logOutAllDevices: async () => {
    set({ saving: true, error: null });
    try {
      const res = await fetch("/api/user/sessions", { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "Failed to log out devices"));
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to log out devices" });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  deleteAccount: async () => {
    set({ saving: true, error: null });
    try {
      const res = await fetch("/api/user", { method: "DELETE" });
      if (!res.ok) throw new Error(await readError(res, "Failed to delete account"));
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to delete account" });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  exportData: async () => {
    set({ error: null });
    try {
      const res = await fetch("/api/user/export", { cache: "no-store" });
      if (!res.ok) throw new Error(await readError(res, "Failed to export data"));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "chat-data-export.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : "Failed to export data" });
      return false;
    }
  },
}));
