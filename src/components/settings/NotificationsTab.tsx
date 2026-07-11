"use client";

import { useSettingsStore } from "@/store/settings";
import { SettingsPanel, SettingRow, Toggle, SelectControl } from "./primitives";

/** Notifications tab: how the user is alerted about responses and tasks. */
export function NotificationsTab() {
  const prefs = useSettingsStore((s) => s.prefs);
  const setPref = useSettingsStore((s) => s.setPref);

  return (
    <SettingsPanel
      title="Notifications"
      description="Manage how you're notified when responses and tasks are ready."
    >
      <SettingRow
        label="Responses"
        description="Get notified when a response is ready if you've navigated away."
        control={
          <Toggle
            checked={prefs.notifResponses}
            onChange={(next) => setPref("notifResponses", next)}
            label="Notify me when responses are ready"
          />
        }
      />
      <SettingRow
        label="Tasks"
        description="How to notify you when a scheduled task completes."
        control={
          <SelectControl
            value={prefs.notifTasks}
            onChange={(v) =>
              setPref("notifTasks", v as typeof prefs.notifTasks)
            }
            options={[
              { value: "push", label: "Push" },
              { value: "email", label: "Email" },
              { value: "both", label: "Push & Email" },
              { value: "off", label: "None" },
            ]}
          />
        }
      />
    </SettingsPanel>
  );
}

export default NotificationsTab;
