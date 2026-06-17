import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import RegisterForm from "@/components/auth/RegisterForm";

export const runtime = "nodejs";

export default async function RegisterPage() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/");
  }

  const githubEnabled = !!process.env.GITHUB_ID && !!process.env.GITHUB_SECRET;

  return <RegisterForm githubEnabled={githubEnabled} />;
}
