import type { ReactNode } from "react";

/**
 * Minimal centered layout for the auth pages (login / register).
 * Renders a full-height dark backdrop with the auth card centered.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-main px-4 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
