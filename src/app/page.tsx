import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import ChatApp from "@/components/chat/ChatApp";

// Reads the session (cookies) and is per-user; never prerender.
export const dynamic = "force-dynamic";

/**
 * Authenticated chat home. Renders a fresh chat. Unauthenticated visitors are
 * redirected to /login.
 */
export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return <ChatApp />;
}
