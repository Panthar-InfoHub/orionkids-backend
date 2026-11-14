import { betterAuth, APIError } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.js";
import { logger } from "./logger.js";
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
        after: async (user) => {
          logger.info({ userId: user.id }, "auth.user_registration_completed");
          try {
            if (user.role !== "ADMIN") {
              const { ensureUserAccessRequest } = await import(
                "../services/registration.service.js"
              );
              await ensureUserAccessRequest(user.id, {
                source: "auth_user_create",
              });
            }
          } catch (err) {
            logger.error(
              { err, userId: user.id },
              "auth.user_create_hook_error"
            );
          }
        },
      },
      update: {
        before: async (user) => {
          // Prevent null/empty image from overwriting valid existing profile picture
          if (!user.image) {
            const existing = await prisma.user.findUnique({
              where: { id: user.id },
              select: { image: true },
            });
            if (existing?.image) {
              return {
                data: {
                  ...user,
                  image: existing.image,
                },
              };
            }
          }
          return { data: user };
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
              message: "Your account access is currently restricted.",
              code: "ACCOUNT_RESTRICTED",
            });
          }

          return { data: session };
        },
        after: async (session) => {
          logger.info(
            { userId: session.userId, sessionId: session.id },
            "auth.user_synchronization_completed"
          );
          try {
            const { ensureUserAccessRequest } = await import(
              "../services/registration.service.js"
            );
            await ensureUserAccessRequest(session.userId, {
              source: "auth_session_create",
            });
          } catch (err) {
            logger.error(
              { err, userId: session.userId },
              "auth.session_create_hook_error"
            );
          }
        },
      },
    },
  },
  onAPIError: {
    errorURL: `${env.BETTER_AUTH_URL}/api/auth/error`,
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
