# OrionKids Backend API

Production-ready REST API backend for the OrionKids platform.

## Tech Stack

- **Runtime & Language**: Node.js 24+, TypeScript 7, ES Modules (`"type": "module"`)
- **Framework**: Express 5
- **Database & ORM**: PostgreSQL (Neon Serverless) with Prisma 7
- **Validation**: Zod
- **Logging**: Pino & Pino-HTTP (with credentials redaction & pretty-printing in dev)
- **Code Quality**: Prettier (formatting), strict TypeScript checks

---

## Getting Started

### 1. Requirements

- [Node.js](https://nodejs.org) >= 24
- [Neon](https://neon.tech) PostgreSQL account

### 2. Install Dependencies

```bash
npm install
```

_(Note: `postinstall` automatically runs `prisma generate` to build the Prisma client)._

### 3. Configure Environment Variables

Copy the `.env.example` template:

```bash
cp .env.example .env
```

Set your values in `.env`:

| Variable       | Description                                            | Example                                      |
| -------------- | ------------------------------------------------------ | -------------------------------------------- |
| `NODE_ENV`     | Environment mode                                       | `development` / `production` / `test`        |
| `PORT`         | API listening port                                     | `8080`                                       |
| `LOG_LEVEL`    | Pino log level                                         | `debug` / `info`                             |
| `DATABASE_URL` | Neon **pooled** connection string (contains `-pooler`) | `postgresql://...-pooler...?sslmode=require` |
| `DIRECT_URL`   | Neon **direct** connection string (no `-pooler`)       | `postgresql://...?sslmode=require`           |
| `CORS_ORIGINS` | Allowed frontend origin(s)                             | `http://localhost:3000`                      |

---

## Neon & Prisma Setup Guide

Prisma uses a dual-connection architecture to optimize for serverless web requests and CLI migrations:

1. **Create Database in Neon**:
   - Go to [Neon Console](https://console.neon.tech) and create a project (e.g. `orionkids-db`).
   - Click **Connect** on the project dashboard.
2. **Retrieve the Two Connection Strings**:
   - **Pooled connection (`DATABASE_URL`)**: Toggle **Connection pooling** to **ON**. The host contains `-pooler`. Copy this into `DATABASE_URL` in `.env`.
   - **Direct connection (`DIRECT_URL`)**: Toggle **Connection pooling** to **OFF**. The host does _not_ contain `-pooler`. Copy this into `DIRECT_URL` in `.env`.
3. **Run Migrations**:
   ```bash
   npm run db:migrate -- --name init
   ```
4. **Generate Prisma Client**:
   ```bash
   npm run db:generate
   ```
5. **Open Prisma Studio (Visual DB viewer)**:
   ```bash
   npm run db:studio
   ```

---

## Running the Application

### Development (Hot-reload)

```bash
npm run dev
```

The server starts at `http://localhost:8080`.

Verify health check:

```bash
curl -i http://localhost:8080/health
```

### Production Build

```bash
npm run build
npm start
```

---

## Available NPM Scripts

| Script         | Command                      | Purpose                                             |
| -------------- | ---------------------------- | --------------------------------------------------- |
| `dev`          | `tsx watch src/server.ts`    | Development server with auto-restart on file change |
| `build`        | `tsc -p tsconfig.build.json` | Compile TypeScript into `dist/`                     |
| `start`        | `node dist/server.js`        | Run compiled production server                      |
| `typecheck`    | `tsc --noEmit`               | Strict type validation                              |
| `format`       | `prettier --write .`         | Automatically format all codebase files             |
| `format:check` | `prettier --check .`         | Verify code style conformance                       |
| `db:generate`  | `prisma generate`            | Generate Prisma client into `src/generated/prisma`  |
| `db:migrate`   | `prisma migrate dev`         | Create and apply migration in development           |
| `db:deploy`    | `prisma migrate deploy`      | Apply migrations in production/CI                   |
| `db:studio`    | `prisma studio`              | Interactive web UI for viewing database tables      |

---

## Architecture & Directory Structure

```
orionkids-backend/
├── prisma/
│   ├── migrations/            # Auto-generated database migration history
│   └── schema.prisma          # Database models and mappings
├── src/
│   ├── config/
│   │   └── env.ts             # Zod schema validation for environment variables
│   ├── controllers/           # HTTP controllers (parse request, send response)
│   ├── generated/             # Auto-generated Prisma client (git-ignored)
│   ├── lib/
│   │   ├── logger.ts          # Structured Pino logger
│   │   └── prisma.ts          # Singleton PrismaClient with Neon adapter
│   ├── middlewares/
│   │   ├── errorHandler.ts    # Centralized error mapping & formatting
│   │   └── notFound.ts        # 404 handler for unmapped routes
│   ├── routes/                # Express router declarations
│   ├── services/              # Business logic & Prisma data operations
│   ├── utils/
│   │   ├── apiResponse.ts     # Standardized JSON response envelope
│   │   ├── asyncHandler.ts    # Safe promise resolution wrapper for handlers
│   │   └── errors.ts          # Custom AppError taxonomy
│   ├── validators/            # Zod validation schemas
│   ├── app.ts                 # Express middleware pipeline and routing
│   └── server.ts              # HTTP server lifecycle and graceful shutdown
├── .env.example
├── .gitignore
├── .prettierrc
├── package.json
├── prisma.config.ts
└── tsconfig.json
```

---

## Standard API Response Envelope

### Success

```json
{
  "success": true,
  "message": "User created",
  "data": {
    "id": "2d8f95c0-1234-4567-89ab-cdef01234567",
    "email": "user@example.com",
    "name": "Jane Doe"
  }
}
```

### Error

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [
      {
        "path": "email",
        "message": "Invalid email address"
      }
    ]
  }
}
```
