import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import ProjectDetail from "@/components/projects/ProjectDetail";

// Reads the session (cookies) and is per-user; never prerender or attempt
// static-path generation for the [id] segment.
export const dynamic = "force-dynamic";

/**
 * A specific project. The client app fetches the project detail by id and
 * renders its instructions, knowledge files, and conversations.
 * Unauthenticated visitors are redirected to /login.
 */
export default async function ProjectPage({
  params,
}: {
  params: { id: string };
}) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login");
  }
  return <ProjectDetail projectId={params.id} />;
}
