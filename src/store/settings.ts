"use client";

import { create } from "zustand";

export type Theme = "system" | "light" | "dark";
export type NotifChannels = "both" | "push" | "email" | "off";

/** Accent hues shown in General → Accent color. `rgb`/`hover` are raw channels
 *  ("R G B") to match the Tailwind `<alpha-value>` token format. */
export const ACCENTS: { id: string; label: string; rgb: string; hover: string }[] = [
  { id: "default", label: "Default", rgb: "16 163 127", hover: "13 138 107" },
  { id: "blue", label: "Blue", rgb: "37 99 235", hover: "29 78 216" },
  { id: "green", label: "Green", rgb: "34 152 84", hover: "27 122 68" },
  { id: "yellow", label: "Yellow", rgb: "202 138 4", hover: "161 98 7" },
  { id: "orange", label: "Orange", rgb: "234 88 12", hover: "194 65 12" },
  { id: "pink", label: "Pink", rgb: "219 39 119", hover: "190 24 93" },
];

/** Local-only UI preferences (persisted to localStorage; no backend effect). */
export interface UiPrefs {
  language: string;
  spokenLanguage: string;
  voice: string;
  followUpSuggestions: boolean;
  showAdditionalModels: boolean;
  notifTasks: NotifChannels;
  notifResponses: boolean;
  memorySaved: boolean;
  memoryHistory: boolean;
  improveModel: boolean;
}

const DEFAULT_PREFS: UiPrefs = {
  language: "auto",
  spokenLanguage: "auto",
  voice: "cove",
  followUpSuggestions: true,
  showAdditionalModels: false,
  notifTasks: "push",
  notifResponses: true,
  memorySaved: true,
  memoryHistory: true,
  improveModel: true,
};

export interface SettingsState {
  hydrated: boolean;
  theme: Theme;
  accent: string; // accent id
  prefs: UiPrefs;
  hydrate: () => void;
  setTheme: (theme: Theme) => void;
  setAccent: (accentId: string) => void;
  setPref: <K extends keyof UiPrefs>(key: K, value: UiPrefs[K]) => void;
}

function applyThemeClass(theme: Theme) {
  if (typeof document === "undefined") return;
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  const el = document.documentElement;
  el.classList.remove("light", "dark");
  el.classList.add(resolved === "light" ? "light" : "dark");
}

function applyAccent(accentId: string) {
  if (typeof document === "undefined") return;
  const a = ACCENTS.find((x) => x.id === accentId) ?? ACCENTS[0];
  const el = document.documentElement;
  el.style.setProperty("--color-accent", a.rgb);
  el.style.setProperty("--color-accent-hover", a.hover);
  try {
    if (a.id === "default") {
      localStorage.removeItem("accent");
      localStorage.removeItem("accentHover");
    } else {
      localStorage.setItem("accent", a.rgb);
      localStorage.setItem("accentHover", a.hover);
    }
  } catch {
    /* storage unavailable */
  }
}

// Single system-theme listener (attached while theme === "system").
let mediaListener: ((e: MediaQueryListEvent) => void) | null = null;
function updateSystemListener(theme: Theme) {
  if (typeof window === "undefined") return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  if (mediaListener) mq.removeEventListener("change", mediaListener);
  mediaListener = null;
  if (theme === "system") {
    mediaListener = () => applyThemeClass("system");
    mq.addEventListener("change", mediaListener);
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  hydrated: false,
  theme: "dark",
  accent: "default",
  prefs: DEFAULT_PREFS,

  hydrate: () => {
    if (get().hydrated || typeof window === "undefined") return;
    let theme: Theme = "dark";
    let accent = "default";
    let prefs = DEFAULT_PREFS;
    try {
      const t = localStorage.getItem("theme");
      if (t === "system" || t === "light" || t === "dark") theme = t;
      const storedAccentRgb = localStorage.getItem("accent");
      const match = ACCENTS.find((a) => a.rgb === storedAccentRgb);
      accent = match ? match.id : "default";
      const raw = localStorage.getItem("uiPrefs");
      if (raw) prefs = { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<UiPrefs>) };
    } catch {
      /* ignore */
    }
    updateSystemListener(theme);
    set({ hydrated: true, theme, accent, prefs });
  },

  setTheme: (theme) => {
    try {
      localStorage.setItem("theme", theme);
    } catch {
      /* ignore */
    }
    applyThemeClass(theme);
    updateSystemListener(theme);
    set({ theme });
  },

  setAccent: (accentId) => {
    applyAccent(accentId);
    set({ accent: accentId });
  },

  setPref: (key, value) => {
    const prefs = { ...get().prefs, [key]: value };
    try {
      localStorage.setItem("uiPrefs", JSON.stringify(prefs));
    } catch {
      /* ignore */
    }
    set({ prefs });
  },
}));
