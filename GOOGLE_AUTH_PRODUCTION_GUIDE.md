# OrionKids - Production Google OAuth & Auth Endpoints Integration Guide

This guide provides an end-to-step-step blueprint for wiring Google OAuth 2.0 and Better Auth endpoints between the **OrionKids Backend (Express 5 + Better Auth)** and the **OrionKids Frontend (Next.js / React)**.

---

## 1. Analysis of the Frontend Error

In your frontend screenshot (`http://localhost:3000/login`), two issues are occurring:

1. **Red dot on `fetch('${API_BASE_URL}/api/me')` (line 22 of `auth.ts`)**:
   - On initial page load, the frontend checks if the user is already logged in by calling `GET /api/me`.
   - Before signing in, no session cookie exists. The backend correctly returns `401 Unauthorized` with `{ "success": false, "error": { "code": "UNAUTHENTICATED" } }`.
   - If the backend is down, or if CORS blocks the preflight request, or if the frontend treat `401` as an unhandled exception, Chrome DevTools marks line 22 as a runtime error.
2. **Google Sign-In Failure ("Continue with Google")**:
   - Google Sign-In requires a 3-way handshake between **Frontend (Next.js)**, **Backend (Better Auth)**, and **Google Cloud Console**.
   - The most common failures are:
     - **Redirect URI Mismatch**: Setting the Google Console redirect URI to the frontend instead of the backend (`/api/auth/callback/google`).
     - **Missing Backend Environment Variables**: `GOOGLE_CLIENT_ID` or `GOOGLE_CLIENT_SECRET` missing in backend `.env`.
     - **Cookie Partitioning / Third-Party Cookie Blocking**: In development (`localhost:3000` calling `localhost:8080`) or browsers like Brave (visible in your screenshot), cross-origin cookies may be blocked unless `credentials: "include"` and proper CORS headers are present.

---

## 2. Complete Authentication Architecture

```
[ Frontend (Next.js :3000) ]
        │
        │ 1. Click "Continue with Google"
        │    authClient.signIn.social({ provider: "google", callbackURL: "/dashboard" })
        ▼
[ Backend (Express :8080) ] ── POST /api/auth/sign-in/social
        │
        │ 2. Generates state, nonce, PKCE, and redirects
        ▼
[ Google OAuth 2.0 ] ── accounts.google.com/o/oauth2/v2/auth
        │
        │ 3. User grants consent
        ▼
[ Backend (Express :8080) ] ── GET /api/auth/callback/google?code=...&state=...
        │
        │ 4. Exchanges code for tokens with Google
        │ 5. Upserts User & Account records in PostgreSQL (Neon)
        │ 6. Creates Session record
        │ 7. Emits 'Set-Cookie: better-auth.session_token' (HttpOnly)
        │ 8. HTTP 302 Redirect to callbackURL (http://localhost:3000/dashboard)
        ▼
[ Frontend (Next.js :3000) ] ── Lands on /dashboard
        │
        │ 9. Calls GET /api/me (credentials: "include")
        ▼
[ Backend (Express :8080) ]
        │ 10. Validates session cookie, queries role & status
        └── Returns { success: true, data: { id, name, email, role, status } }
```

---

## 3. Step 1: Google Cloud Console Configuration

Go to [Google Cloud Console](https://console.cloud.google.com/) -> **APIs & Services** -> **Credentials**:

### 1. Configure OAuth Consent Screen
- **User Type**: External (or Internal if Google Workspace)
- **App Name**: OrionKids
- **User Support Email**: your team email
- **Scopes**: `.../auth/userinfo.email`, `.../auth/userinfo.profile`, `openid`

### 2. Create OAuth 2.0 Client ID
- **Application Type**: **Web Application**
- **Name**: `OrionKids Web Client`
- **Authorized JavaScript origins**:
  - Development:
    - `http://localhost:3000` (Frontend)
    - `http://localhost:8080` (Backend)
  - Production:
    - `https://app.orionkids.com` (Frontend domain)
    - `https://api.orionkids.com` (Backend domain)
- **Authorized redirect URIs (CRITICAL - MUST BE BACKEND CALLBACK)**:
  - Development:
    - `http://localhost:8080/api/auth/callback/google`
  - Production:
    - `https://api.orionkids.com/api/auth/callback/google`

> [!IMPORTANT]
> Do NOT set the redirect URI to `http://localhost:3000/...`. The OAuth code must be received and exchanged by the **backend server** at `/api/auth/callback/google`.

---

## 4. Step 2: Backend Endpoints & Configuration

Your backend in `/home/dev/codes/orionkids-backend` is already configured with Express 5 and Better Auth. Ensure your `.env` contains the required keys:

### 1. Backend Environment Variables (`.env`)

```env
NODE_ENV=development
PORT=8080
LOG_LEVEL=debug

# Neon Database
DATABASE_URL=postgresql://user:password@ep-xyz-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require
DIRECT_URL=postgresql://user:password@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require

# CORS: Frontend URLs allowed to communicate with this backend
CORS_ORIGINS=http://localhost:3000

# Better Auth Secret (minimum 32 characters)
BETTER_AUTH_SECRET=your_super_secret_key_at_least_32_characters_long
BETTER_AUTH_URL=http://localhost:8080

# Production Cookie Domain (leave empty in local development)
# In production with app.orionkids.com and api.orionkids.com:
# COOKIE_DOMAIN=.orionkids.com

# Google OAuth Credentials from Step 1
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-google-client-secret
```

### 2. Better Auth Configuration (`src/lib/auth.ts`)

Verify your Better Auth configuration matches:

```typescript
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
  advanced: {
    defaultCookieAttributes: {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? "lax" : "lax",
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
```

### 3. Route Mounting in Express 5 (`src/app.ts`)

Better Auth must be mounted before body parsers:

```typescript
// Mount Better Auth handler BEFORE express.json()
app.all("/api/auth/*splat", toNodeHandler(auth));
```

---

## 5. Step 3: Auth Endpoints Mapping Reference

| Endpoint | Method | Caller | Purpose | Request Payload | Response |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/api/auth/sign-in/social` | `POST` | Frontend Auth Client | Initiates Google OAuth flow | `{ "provider": "google", "callbackURL": "http://localhost:3000/dashboard" }` | `{ "url": "https://accounts.google.com/..." }` or 302 Redirect |
| `/api/auth/callback/google` | `GET` | Google OAuth Service | Exchanges auth code for session | Query: `?code=...&state=...` | Sets `better-auth.session_token` cookie & redirects to `callbackURL` |
| `/api/auth/get-session` | `GET` | Frontend Auth Client | Retrieves current Better Auth session | None (uses cookie) | `{ "session": { ... }, "user": { ... } }` or `null` |
| `/api/auth/sign-out` | `POST` | Frontend Auth Client | Logs out and invalidates session | `{}` | Clears cookie & returns `{ "success": true }` |
| `/api/me` | `GET` | Frontend API layer | Fetches user profile, role, & status | None (Credentials: include) | `{ "success": true, "data": { "id", "name", "email", "role", "status" } }` |

---

## 6. Step 4: Frontend Implementation (Next.js / React)

### 1. Better Auth Client (`lib/auth-client.ts`)

```typescript
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080",
  fetchOptions: {
    credentials: "include", // Ensure session cookies are sent and received
  },
});

export const { signIn, signOut, useSession } = authClient;
```

### 2. Profile Fetch Helper (`lib/api/auth.ts`)

Update `fetchCurrentUserProfile()` to handle unauthenticated 401 status cleanly without console errors:

```typescript
export interface UserProfile {
  id: string;
  name: string;
  email: string;
  image: string | null;
  role: "USER" | "ADMIN";
  status: "PENDING" | "ACTIVE" | "RESTRICTED";
  restrictedReason: string | null;
}

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

/**
 * Fetch fresh user profile from backend `/api/me`.
 * Returns null if unauthenticated or session expired without throwing uncaught errors.
 */
export async function fetchCurrentUserProfile(): Promise<UserProfile | null> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/me`, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
      },
    });

    // 401 means user is simply not logged in; return null safely
    if (res.status === 401) {
      return null;
    }

    if (!res.ok) {
      console.warn(`[auth] /api/me returned status ${res.status}`);
      return null;
    }

    const payload = await res.json();
    if (payload.success && payload.data) {
      return payload.data as UserProfile;
    }

    return null;
  } catch (error) {
    // Network failure (e.g. backend server is not running)
    console.error("[auth] Failed to connect to backend /api/me:", error);
    return null;
  }
}
```

### 3. Google Sign-In Button Handler (`components/auth/LoginCard.tsx` or similar)

```typescript
"use client";

import { useState } from "react";
import { signIn } from "@/lib/auth-client";

export function GoogleSignInButton() {
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      setErrorMessage(null);

      await signIn.social({
        provider: "google",
        // The URL user lands on after Google finishes:
        callbackURL: `${window.location.origin}/dashboard`,
      });
    } catch (err: any) {
      console.error("Google sign-in error:", err);
      setErrorMessage(err.message || "Failed to initiate Google sign-in.");
      setIsLoading(false);
    }
  };

  return (
    <div>
      <button
        onClick={handleGoogleLogin}
        disabled={isLoading}
        className="flex items-center justify-center gap-3 w-full py-3 px-4 border rounded-xl font-medium shadow-sm hover:bg-gray-50 transition"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24">
          {/* Google G SVG Icon */}
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
        <span>{isLoading ? "Connecting to Google..." : "Continue with Google"}</span>
      </button>

      {errorMessage && (
        <p className="mt-2 text-sm text-red-600 text-center">{errorMessage}</p>
      )}
    </div>
  );
}
```

---

## 7. Production Deployment Architecture & Checklist

When deploying to production (e.g. Frontend on Vercel and Backend on Render/Railway/ECS):

### Scenario A: Shared Parent Domain (Recommended)
- Frontend: `https://app.orionkids.com`
- Backend: `https://api.orionkids.com`
- **Backend `.env` Configuration**:
  ```env
  COOKIE_DOMAIN=.orionkids.com
  BETTER_AUTH_URL=https://api.orionkids.com
  CORS_ORIGINS=https://app.orionkids.com
  ```
- **Cookie Behaviour**:
  Cookies set with `Domain=.orionkids.com`, `SameSite=Lax`, `Secure=true` are automatically shared seamlessly between `api.orionkids.com` and `app.orionkids.com`.

### Scenario B: Separate Domains (Cross-Origin)
- Frontend: `https://orionkids-frontend.vercel.app`
- Backend: `https://orionkids-backend.up.railway.app`
- **Configuration Required**:
  - `COOKIE_DOMAIN` must be omitted.
  - Better Auth cookie must use `sameSite: "none"` and `secure: true`.
  - Backend Express must have `app.set("trust proxy", 1)` enabled.
  - CORS must have explicit `origin: "https://orionkids-frontend.vercel.app"` and `credentials: true`.

---

## 8. Common Troubleshooting Guide

| Issue | Symptom | Exact Solution |
| :--- | :--- | :--- |
| **Redirect URI Mismatch** | Google displays `Error 400: redirect_uri_mismatch` | Ensure Authorized Redirect URI in Google Console is `http://localhost:8080/api/auth/callback/google` (backend), NOT the frontend port or path. |
| **Brave Browser Blocking** | Red error on `/api/me`, cookie not set after redirect | In Brave, test with Shields down for `localhost:3000` or enable third-party cookies in dev settings. |
| **CORS Blocked** | `Access to fetch at ... from origin 'http://localhost:3000' has been blocked by CORS policy` | Check backend `.env`: `CORS_ORIGINS=http://localhost:3000`. Ensure backend is running and `app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }))` is active. |
| **Backend Not Running** | `GET http://localhost:8080/api/me net::ERR_CONNECTION_REFUSED` | Start backend with `npm run dev` in `/home/dev/codes/orionkids-backend`. |
| **401 Logged as Error** | DevTools debugger pauses on line 22 of `auth.ts` | Update `fetchCurrentUserProfile()` to treat `res.status === 401` as a normal unauthenticated state returning `null`, rather than treating it as an error. |
