import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import ProjectsApp from "@/components/projects/ProjectsApp";

// Reads the session (cookies) and is per-user; never prerender.
export const dynamic = "force-dynamic";

/**
 * Projects home. Lists the signed-in user's projects (workspaces that group
 * conversations and carry custom instructions + knowledge files) and lets them
 * create new ones. Unauthenticated visitors are redirected to /login.
 */
export default async function ProjectsPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return <ProjectsApp />;
}
