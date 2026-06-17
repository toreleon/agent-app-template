
import type { NextAuthOptions, Session } from "next-auth";
import { getServerSession } from "next-auth";
import { PrismaAdapter } from "@next-auth/prisma-adapter";
import CredentialsProvider from "next-auth/providers/credentials";
import GitHubProvider from "next-auth/providers/github";
import bcrypt from "bcryptjs";

import prisma from "@/lib/db";

// ---------------------------------------------------------------------------
// NextAuth module augmentation: put the user id on the session.
// Other agents rely on `session.user.id` being a string after a null check.
// ---------------------------------------------------------------------------
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
  }
}

const githubEnabled =
  !!process.env.GITHUB_ID && !!process.env.GITHUB_SECRET;

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: "jwt",
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) {
          return null;
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user || !user.hashedPassword) {
          return null;
        }

        const valid = await bcrypt.compare(password, user.hashedPassword);
        if (!valid) {
          return null;
        }

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          image: user.image,
        };
      },
    }),
    // GitHub provider is only registered when env vars are present.
    ...(githubEnabled
      ? [
          GitHubProvider({
            clientId: process.env.GITHUB_ID as string,
            clientSecret: process.env.GITHUB_SECRET as string,
          }),
        ]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // On initial sign-in, `user` is present; persist the id on the token.
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.id as string) ?? (token.sub as string);
      }
      return session;
    },
  },
};

/**
 * Server-side session helper usable in Route Handlers and Server Components.
 * Equivalent to `getServerSession(authOptions)`.
 */
export function auth(): Promise<Session | null> {
  return getServerSession(authOptions);
}
