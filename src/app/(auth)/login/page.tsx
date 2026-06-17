import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import LoginForm from "@/components/auth/LoginForm";

export const runtime = "nodejs";

export default async function LoginPage() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/");
  }

  const githubEnabled = !!process.env.GITHUB_ID && !!process.env.GITHUB_SECRET;

  return <LoginForm githubEnabled={githubEnabled} />;
}
