import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import ChatApp from "@/components/chat/ChatApp";

// Reads the session (cookies) and is per-user; never prerender or attempt
// static-path generation for the [id] segment.
export const dynamic = "force-dynamic";

/**
 * A specific conversation. The client app fetches the conversation detail by id
 * and renders its messages. Unauthenticated visitors are redirected to /login.
 */
export default async function ConversationPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return <ChatApp conversationId={params.id} />;
}
