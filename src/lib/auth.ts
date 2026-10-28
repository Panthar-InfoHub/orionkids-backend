import { betterAuth, APIError } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";
import { env, isProd } from "../config/env.js";

export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  trustedOrigins: env.CORS_ORIGINS,
  emailAndPassword: {
    enabled: false,
  },
  socialProviders: {
    google: {
      clientId: env.GOOGLE_CLIENT_ID || "",
      clientSecret: env.GOOGLE_CLIENT_SECRET || "",
    },
  },
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders: ["google"],
      requireLocalEmailVerified: true,
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: false,
        defaultValue: "USER",
        input: false,
      },
      status: {
        type: "string",
        required: false,
        defaultValue: "PENDING",
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          return {
            data: {
              ...user,
              role: "USER",
              status: "PENDING",
            },
          };
        },
      },
    },
    session: {
      create: {
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { status: true },
          });

          if (user?.status === "RESTRICTED") {
            throw new APIError("FORBIDDEN", {
              message: "Your account is restricted",
              code: "ACCOUNT_RESTRICTED",
            });
          }

          return { data: session };
        },
      },
    },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
  },
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
    },
    crossSubDomainCookies:
      isProd && env.COOKIE_DOMAIN
        ? {
            enabled: true,
            domain: env.COOKIE_DOMAIN,
          }
        : undefined,
  },
});

export type AuthSession = typeof auth.$Infer.Session;
