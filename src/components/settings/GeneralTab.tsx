"use client";

import { Play } from "lucide-react";
import { ACCENTS, useSettingsStore } from "@/store/settings";
import { cn } from "@/components/ui/cn";
import { SelectControl, SettingRow, SettingsPanel, Toggle } from "./primitives";

/** Language options shared by the written + spoken language selects. */
const LANGUAGE_OPTIONS = [
  { value: "auto", label: "Auto-detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "zh", label: "Chinese" },
  { value: "ja", label: "Japanese" },
  { value: "pt", label: "Portuguese" },
];

/** Voice presets for read-aloud (value stored lowercase). */
const VOICE_OPTIONS = ["Cove", "Breeze", "Ember", "Juniper", "Maple", "Vale"].map(
  (name) => ({ value: name.toLowerCase(), label: name }),
);

/** General tab: appearance, language, voice and chat display preferences. */
export function GeneralTab() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const accent = useSettingsStore((s) => s.accent);
  const setAccent = useSettingsStore((s) => s.setAccent);
  const prefs = useSettingsStore((s) => s.prefs);
  const setPref = useSettingsStore((s) => s.setPref);

  return (
    <SettingsPanel title="General">
      {/* Appearance */}
      <SettingRow
        label="Theme"
        control={
          <SelectControl
            value={theme}
            onChange={(v) => setTheme(v as typeof theme)}
            options={[
              { value: "system", label: "System" },
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
            ]}
          />
        }
      />

      <SettingRow
        label="Accent color"
        control={
          <div className="flex items-center gap-2">
            {ACCENTS.map((a) => {
              const selected = accent === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-label={a.label}
                  aria-pressed={selected}
                  onClick={() => setAccent(a.id)}
                  style={{
                    backgroundColor: `rgb(${a.rgb.split(" ").join(",")})`,
                  }}
                  className={cn(
                    "h-[22px] w-[22px] rounded-full transition-transform hover:scale-105 focus:outline-none",
                    selected &&
                      "ring-2 ring-text-primary ring-offset-2 ring-offset-main",
                  )}
                />
              );
            })}
          </div>
        }
      />

      {/* Language */}
      <SettingRow
        label="Language"
        control={
          <SelectControl
            value={prefs.language}
            onChange={(v) => setPref("language", v)}
            options={LANGUAGE_OPTIONS}
          />
        }
      />

      <SettingRow
        label="Spoken language"
        description="For best results, select the language you mainly speak."
        control={
          <SelectControl
            value={prefs.spokenLanguage}
            onChange={(v) => setPref("spokenLanguage", v)}
            options={LANGUAGE_OPTIONS}
          />
        }
      />

      <SettingRow
        label="Voice"
        control={
          <div className="flex items-center gap-2">
            {/* Preview is a no-op placeholder (audio not wired). */}
            <button
              type="button"
              aria-label="Play voice preview"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-border text-text-primary transition-colors hover:bg-hover focus:outline-none"
            >
              <Play size={14} className="translate-x-px" />
            </button>
            <SelectControl
              value={prefs.voice}
              onChange={(v) => setPref("voice", v)}
              options={VOICE_OPTIONS}
            />
          </div>
        }
      />

      {/* Chat display */}
      <SettingRow
        label="Show follow-up suggestions in chats"
        control={
          <Toggle
            checked={prefs.followUpSuggestions}
            onChange={(v) => setPref("followUpSuggestions", v)}
            label="Show follow-up suggestions in chats"
          />
        }
      />

      <SettingRow
        label="Show additional models"
        control={
          <Toggle
            checked={prefs.showAdditionalModels}
            onChange={(v) => setPref("showAdditionalModels", v)}
            label="Show additional models"
          />
        }
      />
    </SettingsPanel>
  );
}

export default GeneralTab;
