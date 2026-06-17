import bcrypt from "bcryptjs";

import prisma from "@/lib/db";
import type { ApiError, RegisterRequest } from "@/lib/types";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  let body: Partial<RegisterRequest>;
  try {
    body = (await req.json()) as Partial<RegisterRequest>;
  } catch {
    return Response.json(
      { error: "Invalid JSON body" } satisfies ApiError,
      { status: 400 },
    );
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!name) {
    return Response.json(
      { error: "Name is required" } satisfies ApiError,
      { status: 400 },
    );
  }
  if (!email || !EMAIL_RE.test(email)) {
    return Response.json(
      { error: "A valid email is required" } satisfies ApiError,
      { status: 400 },
    );
  }
  if (password.length < 8) {
    return Response.json(
      { error: "Password must be at least 8 characters" } satisfies ApiError,
      { status: 400 },
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return Response.json(
      { error: "An account with this email already exists" } satisfies ApiError,
      { status: 409 },
    );
  }

  const hashedPassword = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: { name, email, hashedPassword },
    select: { id: true, email: true, name: true },
  });

  return Response.json(
    { id: user.id, email: user.email, name: user.name },
    { status: 201 },
  );
}
