"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";
import { LogOut, ShieldCheck } from "lucide-react";
import { useUserStore } from "@/store/user";
import { SettingsPanel, SettingRow, Toggle, RowButton, ConfirmDialog } from "./primitives";

/** Security tab: multi-factor auth (ui-only) and session-wide sign-out. */
export function SecurityTab() {
  const logOutAllDevices = useUserStore((s) => s.logOutAllDevices);
  const error = useUserStore((s) => s.error);

  // Local-only preference: MFA has no backend yet, so it just persists in state.
  const [mfa, setMfa] = useState(false);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogOutAll() {
    setLoggingOut(true);
    const ok = await logOutAllDevices();
    // On success redirect to login; on failure the store surfaces the error.
    if (ok) {
      await signOut({ callbackUrl: "/login" });
      return;
    }
    setLoggingOut(false);
    setConfirmOpen(false);
  }

  return (
    <SettingsPanel title="Security">
      <SettingRow
        label={
          <span className="inline-flex items-center gap-2">
            <ShieldCheck size={15} className="text-text-secondary" />
            Multi-factor authentication
          </span>
        }
        description="Require an extra step when signing in. Not yet available."
        control={
          <Toggle
            checked={mfa}
            onChange={setMfa}
            label="Multi-factor authentication"
          />
        }
      />

      <SettingRow
        label="Log out of all devices"
        description="Log out on all devices. It may take up to 30 minutes."
        control={
          <RowButton danger onClick={() => setConfirmOpen(true)}>
            <LogOut size={15} /> Log out all
          </RowButton>
        }
      />

      {error && <p className="mt-3 text-xs text-red-400">{error}</p>}

      <ConfirmDialog
        open={confirmOpen}
        title="Log out of all devices"
        message="You'll be signed out everywhere, including this device. It may take up to 30 minutes to take effect on other devices."
        confirmLabel="Log out all"
        danger
        loading={loggingOut}
        onConfirm={handleLogOutAll}
        onClose={() => setConfirmOpen(false)}
      />
    </SettingsPanel>
  );
}

export default SecurityTab;
