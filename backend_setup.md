# Implementation Plan: OrionKids Backend Setup

## 1. Overview & Architecture Analysis

Based on the **Backend Base Setup Guide** and our analysis of the `orionkids-frontend` application, this plan outlines the step-by-step implementation for establishing the production-ready starter backend for **OrionKids**.

### Key Architectural Standards & Constraints

- **Runtime & Engine:** Node.js `>=24` (Environment verified: Node `v24.13.0`, npm `11.6.2`, git `2.43.0`).
- **ES Modules & Resolution:** `"type": "module"` in `package.json` with TypeScript `moduleResolution: "nodenext"`. **All relative local imports strictly require `.js` extensions** (e.g., `import { env } from "./config/env.js"`).
- **Web Framework:** Express 5 (`5.3.0`) with `trust proxy: 1`, body parsers, and Helmet/CORS.
- **Database & ORM:** Neon Serverless PostgreSQL with Prisma 7 (`7.10.0`). Dual-connection strategy:
  - `DATABASE_URL`: Pooled connection string (`-pooler`) used by runtime `@prisma/adapter-neon`.
  - `DIRECT_URL`: Direct connection string (non-pooled) used by Prisma CLI (`prisma.config.ts`) for migrations and studio.
- **Type Safety & Validation:** Zod (`4.6.5`) for environment variables (`src/config/env.ts`) and request validation schemas (`src/validators/`).
- **Logging & Observability:** Pino (`10.4.0`) + `pino-http` with sensitive field redaction (passwords, tokens, cookies, auth headers) and `pino-pretty` in development.
- **Centralized Error & Response Flow:** Standard envelope response formats (`sendSuccess`, `AppError` taxonomy, Zod and Prisma error normalization) and graceful shutdown hooks (`SIGTERM`, `SIGINT`, `unhandledRejection`, `uncaughtException`).

---

## 2. Phased Implementation Plan

### Phase 1: Project Initialization & Tooling

1. **Initialize Git Repository:**
   - Execute `git init -b main` in `/home/dev/codes/orionkids-backend`.
2. **Setup `package.json`:**
   - Configure name (`orionkids-backend`), private status, `type: "module"`, engine `>=24`, and npm scripts (`dev`, `build`, `start`, `typecheck`, `format`, `format:check`, `db:generate`, `db:migrate`, `db:deploy`, `db:studio`).
3. **Install Pinned Dependencies:**
   - **Runtime:** `express@5.3.0`, `cors@2.8.6`, `helmet@8.3.0`, `dotenv@18.0.7`, `zod@4.6.5`, `pino@10.4.0`, `pino-http@11.0.0`, `@neondatabase/serverless@1.2.0`, and exact `@prisma/client@7.10.0`, `@prisma/adapter-neon@7.10.0`.
   - **Dev:** `typescript@7.0.2`, `tsx@4.23.15`, `@types/node@24.19.2`, `@types/express@5.0.6`, `@types/cors@2.8.19`, `pino-pretty@13.2.0`, and exact `prisma@7.10.0`, `prettier@3.9.10`.
4. **TypeScript Configuration:**
   - Create `tsconfig.json` with ES2023, `nodenext` modules, strict checks (`noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `noEmit: true`).
   - Create `tsconfig.build.json` targeting `src/` -> `dist/` with `noEmit: false`.
5. **Code Style & Git Policies:**
   - Create `.prettierrc` and `.prettierignore`.
   - Create `.vscode/settings.json` (format-on-save with Prettier & Prisma).
   - Create `.gitignore` (ignoring `node_modules`, `dist`, `.env*`, `src/generated`, while preserving `.env.example`).

---

### Phase 2: Environment Configuration & Database Layer

1. **Environment Setup:**
   - Create `.env.example` defining `PORT=8080`, `NODE_ENV=development`, `LOG_LEVEL=debug`, `CORS_ORIGINS=http://localhost:3000`, `DATABASE_URL`, `DIRECT_URL`.
   - Create local `.env` (template ready for Neon database credentials).
2. **Environment Validator (`src/config/env.ts`):**
   - Enforce Zod parsing with fail-fast startup on invalid environment variables.
3. **Structured Logger (`src/lib/logger.ts`):**
   - Configure Pino with redaction of sensitive credentials and pretty printing in development.
4. **Prisma Setup:**
   - Create `prisma.config.ts` using `defineConfig` pointing to `prisma/schema.prisma` and `DIRECT_URL`.
   - Create `prisma/schema.prisma` with `provider = "prisma-client"`, `output = "../src/generated/prisma"`, and the baseline `User` model.
   - Run initial migration: `npm run db:migrate -- --name init` (or verify via mock/test DB setup).
   - Generate client: `npm run db:generate`.
   - Add `"postinstall": "prisma generate"` to `package.json`.
5. **Prisma Singleton Client (`src/lib/prisma.ts`):**
   - Instantiate `PrismaNeon` with `DATABASE_URL` and export shared `prisma` instance.

---

### Phase 3: Core Framework Utilities & Middleware

1. **Utilities Layer (`src/utils/`):**
   - `errors.ts`: `AppError` base class with `ValidationError` (400), `UnauthorizedError` (401), `ForbiddenError` (403), `NotFoundError` (404), `ConflictError` (409), `TooManyRequestsError` (429).
   - `apiResponse.ts`: Standard response envelope helpers (`sendSuccess`, `ApiSuccessResponse`, `ApiErrorResponse`).
   - `asyncHandler.ts`: Higher-order function wrapping async route handlers.
2. **Middlewares Layer (`src/middlewares/`):**
   - `notFound.ts`: 404 handler forwarding to next with `NotFoundError`.
   - `errorHandler.ts`: 4-parameter Express error handler that normalizes Zod, Prisma (P2002, P2025), body-parser errors, sanitizes internal messages in production, and emits standard JSON responses.

---

### Phase 4: Verification Feature & Application Wiring

1. **Baseline "Users" Feature:**
   - `src/validators/user.schema.ts`: Zod schema for `createUserSchema`, `userIdParamSchema`.
   - `src/services/user.service.ts`: Business logic and Prisma queries (`listUsers`, `getUserById`, `createUser`).
   - `src/controllers/user.controller.ts`: Request parsing, service invocation, standard responses.
   - `src/routes/user.routes.ts` & `src/routes/index.ts`: Route declarations under `/api/users`.
2. **Express App (`src/app.ts`):**
   - Assemble `helmet`, `cors` (supporting `CORS_ORIGINS` for `orionkids-frontend`), body parsers, `pinoHttp` request logger.
   - Mount `/health` endpoint validating DB connectivity (`SELECT 1`).
   - Mount `/api` routes, followed by `notFoundHandler` and `errorHandler`.
3. **Server Entrypoint & Lifecycle (`src/server.ts`):**
   - Start HTTP listener on `env.PORT`.
   - Implement graceful shutdown on `SIGTERM` / `SIGINT` with connection draining and Prisma disconnect.
   - Attach listeners for `unhandledRejection` and `uncaughtException`.

---

### Phase 5: Verification & Production Readiness

1. **Typecheck & Linting:**
   - Run `npm run typecheck` to verify complete compile-time type safety.
   - Run `npm run format:check` and `npm run format`.
2. **Verification Test Suite (9 Test Cases):**
   - Test 1: Health check (`GET /health` -> 200).
   - Test 2: User creation (`POST /api/users` -> 201).
   - Test 3: List users (`GET /api/users` -> 200).
   - Test 4: Get user by ID (`GET /api/users/:id` -> 200).
   - Test 5: Conflict handling on duplicate email (`POST /api/users` -> 409).
   - Test 6: Body validation failure (`POST /api/users` with invalid email -> 400).
   - Test 7: Param validation failure (`GET /api/users/123` with invalid UUID -> 400).
   - Test 8: Not found handling (`GET /api/does-not-exist` -> 404).
   - Test 9: Graceful shutdown on termination signal.
3. **Build & Documentation:**
   - Execute `npm run build` to confirm `dist/server.js` compiles cleanly.
   - Create project `README.md`.
   - Verify `.gitignore` rules (ensure `.env` is omitted from Git index).
   - Perform initial Git commit.

---

### Phase 6: Roadmap for OrionKids Domain Features

Once the starter base is verified, the next phase will implement OrionKids-specific APIs required by `orionkids-frontend`:

1. **Printables Module:**
   - Routes: `GET /api/printables`, `POST /api/printables/:id/download`, `POST /api/printables/custom-request`.
   - Models: `Printable`, `PrintableDownload`, `CustomRequest`.
2. **Warm-Up / Assessments Module:**
   - Routes: `POST /api/warm-up/submit`.
   - Models: `WarmUpSubmission`.
3. **Games / Stroop Module:**
   - Routes: `POST /api/games/stroop/level-submit`.
   - Models: `StroopGameSession`, `StroopTrialResult`.
4. **Blog & Newsletter Module:**
   - Routes: `GET /api/blog`, `POST /api/newsletter`.
   - Models: `BlogPost`, `NewsletterSubscriber`.

---

## 3. Decisions & Inputs Needed from User

Before executing database migrations:

1. **Neon Database Connection Strings:**
   - Do you have a Neon PostgreSQL project created with both pooled (`DATABASE_URL`) and direct (`DIRECT_URL`) connection strings available, or would you like to set up the code scaffolding first with a placeholder `.env`?
2. **CORS Origins:**
   - The default is configured for `http://localhost:3000` (Next.js default). Are there any additional local or staging origins you would like included?
