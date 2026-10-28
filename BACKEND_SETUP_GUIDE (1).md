# Backend Base Setup Guide

A step-by-step guide to building our standard backend starter **from an empty folder**.

You will type every command and create every file yourself. Each step explains **what** you are doing and **why**, so that by the end you understand every part of the base and can build any project on top of it.

> **How to use this guide**
>
> - Do the steps **in order**. Each step depends on the one before it.
> - Every command is shown twice: once for **Windows (PowerShell)** and once for **macOS / Linux (Terminal)**. Use the one for your computer. Sometimes both are the same; they are still shown so you never have to guess.
> - When a step says **"Check"**, do the check before moving on. If it fails, look in [Common problems](#common-problems-and-fixes) at the end.
> - Type the code yourself instead of copy-pasting when you can. You will remember it much better.

---

## Table of contents

1. [What you are going to build](#1-what-you-are-going-to-build)
2. [Install the tools you need](#2-install-the-tools-you-need)
3. [Create the project folder and start Git](#3-create-the-project-folder-and-start-git)
4. [Create package.json](#4-create-packagejson)
5. [Install the packages](#5-install-the-packages)
6. [Set up TypeScript](#6-set-up-typescript)
7. [Set up Prettier (code formatting)](#7-set-up-prettier-code-formatting)
8. [Create .gitignore](#8-create-gitignore)
9. [Create the database on Neon](#9-create-the-database-on-neon)
10. [Create the environment files (.env)](#10-create-the-environment-files-env)
11. [Create the folder structure](#11-create-the-folder-structure)
12. [Environment config (src/config/env.ts)](#12-environment-config)
13. [Logger (src/lib/logger.ts)](#13-logger)
14. [Prisma: schema, config and first migration](#14-prisma-schema-config-and-first-migration)
15. [Prisma client (src/lib/prisma.ts)](#15-prisma-client)
16. [Helper utilities (src/utils)](#16-helper-utilities)
17. [Middlewares: 404 and error handler](#17-middlewares-404-and-error-handler)
18. [The example "users" feature](#18-the-example-users-feature)
19. [The Express app (src/app.ts)](#19-the-express-app)
20. [The server (src/server.ts)](#20-the-server)
21. [Run it and test everything](#21-run-it-and-test-everything)
22. [Format the code and build for production](#22-format-the-code-and-build-for-production)
23. [Write the README](#23-write-the-readme)
24. [Make your first Git commit](#24-make-your-first-git-commit)
25. [How to add a new feature later](#25-how-to-add-a-new-feature-later)
26. [Common problems and fixes](#common-problems-and-fixes)
27. [Final checklist](#final-checklist)

---

## 1. What you are going to build

A small but production-ready **REST API server**. It does not do anything business-specific yet; it is the **base** that every project starts from. It includes:

| Feature                      | What it means                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| **Express 5**                | The web framework that receives HTTP requests and sends responses.                          |
| **TypeScript**               | JavaScript with types. Catches many mistakes before you run the code.                       |
| **Prisma + Neon PostgreSQL** | Prisma is how our code talks to the database. Neon is the cloud PostgreSQL database we use. |
| **Zod validation**           | Checks that incoming data (and our `.env` file) has the right shape.                        |
| **Pino logging**             | Fast, structured logs. Pretty in development, JSON in production.                           |
| **Central error handling**   | Every error in the app ends up in one place and is turned into a clean JSON response.       |
| **Standard response format** | Every response looks the same, so the frontend always knows what to expect.                 |
| **Security headers + CORS**  | Basic protection that every web API needs.                                                  |
| **Health check**             | A `/health` URL that tells you the server and database are working.                         |
| **Graceful shutdown**        | When the server stops, it finishes current requests and closes the database cleanly.        |
| **Prettier**                 | Automatically formats code so everyone's code looks the same.                               |
| **Example "users" feature**  | A tiny working feature used to **prove the whole setup works**.                             |

### What the final project looks like

```
my-backend/
├── prisma/
│   ├── migrations/            ← created automatically by Prisma
│   └── schema.prisma          ← database tables are described here
├── src/
│   ├── config/
│   │   └── env.ts             ← reads and checks .env values
│   ├── controllers/
│   │   └── user.controller.ts ← handles the HTTP request/response
│   ├── generated/             ← created automatically by Prisma (never edit)
│   ├── lib/
│   │   ├── logger.ts          ← the logger
│   │   └── prisma.ts          ← the database client
│   ├── middlewares/
│   │   ├── errorHandler.ts    ← turns errors into JSON responses
│   │   └── notFound.ts        ← handles unknown URLs (404)
│   ├── routes/
│   │   ├── index.ts           ← joins all feature routes together
│   │   └── user.routes.ts     ← URLs for the users feature
│   ├── services/
│   │   └── user.service.ts    ← business logic + database calls
│   ├── utils/
│   │   ├── apiResponse.ts     ← standard success response
│   │   ├── asyncHandler.ts    ← safety wrapper for async handlers
│   │   └── errors.ts          ← our error classes
│   ├── validators/
│   │   └── user.schema.ts     ← rules for valid user data
│   ├── app.ts                 ← builds the Express app
│   └── server.ts              ← starts the server
├── .env                       ← your secrets (NEVER commit)
├── .env.example               ← template of .env (safe to commit)
├── .gitignore
├── .prettierignore
├── .prettierrc
├── package.json
├── prisma.config.ts
├── README.md
├── tsconfig.build.json
└── tsconfig.json
```

### How a request travels through the code

Keep this picture in mind. Every feature you build later follows the same path.

```
 Client (browser / Postman / mobile app)
   │
   ▼
 app.ts        security headers, CORS, read JSON body, log the request
   │
   ▼
 routes/       "which function handles GET /api/users?"
   │
   ▼
 controller    reads the request, VALIDATES it with a Zod schema (validators/)
   │
   ▼
 service       the actual work: business rules + database calls (Prisma)
   │
   ▼
 controller    sends the result with sendSuccess()  ──►  JSON response
   │
   └── if anything throws an error at any point
         ▼
       errorHandler   turns it into a clean JSON error  ──►  JSON response
```

---

## 2. Install the tools you need

You need four things: **Node.js**, **Git**, **VS Code** and a **Neon account**.

### 2.1 Node.js (version 24 or newer)

Node.js runs JavaScript outside the browser. It also installs **npm**, the tool we use to install packages.

- Go to <https://nodejs.org> and download the **LTS** version (24 or newer). Run the installer with the default options.

Or install it from the terminal:

**Windows (PowerShell)**

```powershell
winget install OpenJS.NodeJS.LTS
```

**macOS / Linux (Terminal)**

```bash
# macOS (needs Homebrew: https://brew.sh)
brew install node

# Linux (Ubuntu/Debian): use the official instructions at https://nodejs.org/en/download
```

**Check:** close the terminal, open a new one, and run:

**Windows (PowerShell)**

```powershell
node -v
npm -v
```

**macOS / Linux (Terminal)**

```bash
node -v
npm -v
```

`node -v` must print `v24.x.x` or higher. `npm -v` prints a number such as `11.x.x`.

### 2.2 Git

Git saves the history of your code.

- Download from <https://git-scm.com> and install with the default options.

**Windows (PowerShell)**

```powershell
winget install Git.Git
```

**macOS / Linux (Terminal)**

```bash
# macOS
xcode-select --install

# Linux (Ubuntu/Debian)
sudo apt install git
```

**Check:**

**Windows (PowerShell)**

```powershell
git --version
```

**macOS / Linux (Terminal)**

```bash
git --version
```

If this is the first time you use Git on this computer, tell Git who you are (use your real name and work email):

**Windows (PowerShell)**

```powershell
git config --global user.name "Your Name"
git config --global user.email "you@company.com"
```

**macOS / Linux (Terminal)**

```bash
git config --global user.name "Your Name"
git config --global user.email "you@company.com"
```

### 2.3 VS Code

Download from <https://code.visualstudio.com> and install it. Then open VS Code, go to the **Extensions** panel (the square icon on the left) and install:

- **Prettier - Code formatter** (by Prettier)
- **Prisma** (by Prisma)

### 2.4 Neon account

Go to <https://neon.tech> and sign up (signing in with GitHub or Google is fine). You will create the database in [Step 9](#9-create-the-database-on-neon).

### 2.5 Which terminal to use

- **Windows:** use **PowerShell**. In VS Code: menu **Terminal → New Terminal**. Make sure the dropdown on the right of the terminal panel says "powershell".migrate
- **macOS / Linux:** use the normal **Terminal** (or the VS Code terminal).

---

## 3. Create the project folder and start Git

Pick a place for your code (for example a `Codes` folder) and open a terminal there. Replace `my-backend` with your project's name. Use lowercase letters and dashes only.

**Windows (PowerShell)**

```powershell
mkdir my-backend
cd my-backend
git init -b main
```

**macOS / Linux (Terminal)**

```bash
mkdir my-backend
cd my-backend
git init -b main
```

- `mkdir` creates the folder, `cd` moves into it.
- `git init -b main` turns the folder into a Git repository whose main branch is called `main`.

Now open this folder in VS Code (**File → Open Folder…**). From now on, **every command is run inside this folder**.

---

## 4. Create package.json

`package.json` is the "ID card" of a Node project: its name, the commands you can run, and the list of packages it needs.

**Windows (PowerShell)**

```powershell
npm init -y
```

**macOS / Linux (Terminal)**

```bash
npm init -y
```

This creates a default `package.json`. Open it in VS Code and **replace everything inside it** with this:

```json
{
  "name": "my-backend",
  "version": "1.0.0",
  "description": "",
  "private": true,
  "main": "dist/server.js",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:studio": "prisma studio"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "type": "module"
}
```

Change `"name"` to your project's name.

**What each part means:**

| Field              | Meaning                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `"private": true`  | Stops anyone from publishing this project to the public npm registry by mistake. |
| `"main"`           | The file that runs in production (the compiled server).                          |
| `"engines"`        | Says this project needs Node.js 24 or newer.                                     |
| `"type": "module"` | Tells Node we use modern `import` / `export` syntax (called "ES modules").       |

**The scripts** (you run them with `npm run <name>`):

| Script         | What it does                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------- |
| `dev`          | Starts the server for development and **restarts it automatically** every time you save a file. |
| `build`        | Compiles TypeScript (`src/`) into plain JavaScript (`dist/`) for production.                    |
| `start`        | Runs the compiled server. Used in production after `build`.                                     |
| `typecheck`    | Checks the whole project for type errors without creating any files.                            |
| `format`       | Formats every file with Prettier.                                                               |
| `format:check` | Only **checks** formatting and reports files that are not formatted (changes nothing).          |
| `db:generate`  | Creates the Prisma database client code from `schema.prisma`.                                   |
| `db:migrate`   | Development only: creates a migration from your schema changes and applies it to the database.  |
| `db:deploy`    | Production only: applies existing migrations to the database.                                   |
| `db:studio`    | Opens Prisma Studio, a website on your computer for viewing and editing database data.          |

> **Note:** we will add one more script called `postinstall` in [Step 14](#14-prisma-schema-config-and-first-migration). It is added later on purpose because it needs Prisma files that do not exist yet.

---

## 5. Install the packages

We install **exact, tested versions** so your project behaves the same as the base. Newer versions may change things and break the steps in this guide.

### 5.1 Packages the app needs to run ("dependencies")

**Windows (PowerShell)**

```powershell
npm install express@5.3.0 cors@2.8.6 helmet@8.3.0 dotenv@18.0.7 zod@4.6.5 pino@10.4.0 pino-http@11.0.0 @neondatabase/serverless@1.2.0
npm install --save-exact @prisma/client@7.10.0 @prisma/adapter-neon@7.10.0
```

**macOS / Linux (Terminal)**

```bash
npm install express@5.3.0 cors@2.8.6 helmet@8.3.0 dotenv@18.0.7 zod@4.6.5 pino@10.4.0 pino-http@11.0.0 @neondatabase/serverless@1.2.0
npm install --save-exact @prisma/client@7.10.0 @prisma/adapter-neon@7.10.0
```

### 5.2 Packages only needed while developing ("devDependencies")

**Windows (PowerShell)**

```powershell
npm install --save-dev typescript@7.0.2 tsx@4.23.15 @types/node@24.19.2 @types/express@5.0.6 @types/cors@2.8.19 pino-pretty@13.2.0
npm install --save-dev --save-exact prisma@7.10.0 prettier@3.9.10
```

**macOS / Linux (Terminal)**

```bash
npm install --save-dev typescript@7.0.2 tsx@4.23.15 @types/node@24.19.2 @types/express@5.0.6 @types/cors@2.8.19 pino-pretty@13.2.0
npm install --save-dev --save-exact prisma@7.10.0 prettier@3.9.10
```

> **Why `--save-exact` for some packages?**
> Normally npm saves versions like `^5.3.0`, which means "5.3.0 or any newer 5.x". That is fine for most packages.
> But the three Prisma packages (`prisma`, `@prisma/client`, `@prisma/adapter-neon`) **must always be the exact same version as each other**, or they stop working together. Prettier is also pinned so that everyone's code is formatted identically.

### 5.3 What each package does

| Package                    | Type    | Purpose                                                                     |
| -------------------------- | ------- | --------------------------------------------------------------------------- |
| `express`                  | runtime | The web framework.                                                          |
| `cors`                     | runtime | Controls which websites (frontends) are allowed to call our API.            |
| `helmet`                   | runtime | Adds security-related HTTP headers to every response.                       |
| `dotenv`                   | runtime | Loads values from the `.env` file into `process.env`.                       |
| `zod`                      | runtime | Validates data (request bodies, URL params, `.env` values).                 |
| `pino`                     | runtime | The logger.                                                                 |
| `pino-http`                | runtime | Logs one line for every HTTP request automatically.                         |
| `@prisma/client`           | runtime | The Prisma database client.                                                 |
| `@prisma/adapter-neon`     | runtime | Connects Prisma to Neon's serverless driver.                                |
| `@neondatabase/serverless` | runtime | Neon's database driver.                                                     |
| `typescript`               | dev     | The TypeScript compiler (`tsc`).                                            |
| `tsx`                      | dev     | Runs TypeScript files directly during development, with auto-restart.       |
| `@types/...`               | dev     | Type information for Node, Express and CORS so TypeScript understands them. |
| `pino-pretty`              | dev     | Makes logs colourful and easy to read in development.                       |
| `prisma`                   | dev     | The Prisma command-line tool (migrations, generate, studio).                |
| `prettier`                 | dev     | The code formatter.                                                         |

**Check:** open `package.json`. It should now have a `"dependencies"` block and a `"devDependencies"` block listing all of the packages above. A `node_modules` folder and a `package-lock.json` file have also appeared.

> **Never edit `node_modules` or `package-lock.json` by hand.** npm manages them. `package-lock.json` **must** be committed to Git, because it records the exact version of every package.

---

## 6. Set up TypeScript

TypeScript needs a settings file. We use **two**:

- `tsconfig.json`: the main settings, used by VS Code and by `npm run typecheck`.
- `tsconfig.build.json`: extra settings used only when building for production.

### 6.1 Create `tsconfig.json`

Create a new file called `tsconfig.json` in the project root (right-click in the VS Code file explorer → **New File**) with this content:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "moduleResolution": "nodenext",

    "strict": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true,

    "esModuleInterop": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,

    "types": ["node"],
    "sourceMap": true,
    "noEmit": true
  },
  "include": ["src", "prisma.config.ts"]
}
```

**What the important options mean:**

| Option                                    | Meaning                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target: "ES2023"`                        | Produce modern JavaScript, because Node 24 understands it.                                                                                                       |
| `module` / `moduleResolution: "nodenext"` | Follow Node's own rules for `import`. **This is why every import of our own files ends in `.js`**, even though the file on disk is `.ts` (explained in Step 12). |
| `strict: true`                            | Turns on all of TypeScript's safety checks. Always keep this on.                                                                                                 |
| `noUncheckedIndexedAccess`                | Reminds you that `array[5]` might be `undefined`. Prevents a very common bug.                                                                                    |
| `verbatimModuleSyntax`                    | Forces you to write `import type { ... }` when you import only a type. Keeps the output clean.                                                                   |
| `skipLibCheck`                            | Do not type-check the packages inside `node_modules` (faster, and not our code).                                                                                 |
| `types: ["node"]`                         | Makes Node's built-in types (like `process`) available.                                                                                                          |
| `noEmit: true`                            | This file only **checks** code. It never creates output files.                                                                                                   |
| `include`                                 | Which files TypeScript looks at.                                                                                                                                 |

### 6.2 Create `tsconfig.build.json`

Create `tsconfig.build.json` in the project root:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": false
  },
  "include": ["src"]
}
```

This file **reuses** everything from `tsconfig.json` (`extends`) and changes only three things for the production build:

- read code from `src/` (`rootDir`)
- write the compiled JavaScript to `dist/` (`outDir`)
- actually create the files (`noEmit: false`)

---

## 7. Set up Prettier (code formatting)

Prettier formats code automatically: spaces, quotes, line breaks and so on. The whole team then writes code in the same style and nobody argues about it.

### 7.1 Create `.prettierrc`

Create a file called `.prettierrc` (the name starts with a dot) in the project root:

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "es5",
  "printWidth": 80,
  "tabWidth": 2,
  "endOfLine": "auto"
}
```

| Rule                   | Meaning                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `semi: true`           | Always end statements with `;`.                                                                                                                    |
| `singleQuote: false`   | Use double quotes `"like this"`.                                                                                                                   |
| `trailingComma: "es5"` | Add a comma after the last item in objects and arrays (makes Git diffs cleaner).                                                                   |
| `printWidth: 80`       | Wrap lines longer than 80 characters.                                                                                                              |
| `tabWidth: 2`          | Indent with 2 spaces.                                                                                                                              |
| `endOfLine: "auto"`    | Keep whatever line endings the file already uses. Windows and Mac use different line endings, and this stops Prettier from complaining about them. |

### 7.2 Create `.prettierignore`

Create `.prettierignore` in the project root. It lists files that Prettier must **not** touch:

```
node_modules
dist
src/generated
prisma/migrations
package-lock.json
```

### 7.3 (Recommended) Format automatically when you save

Create a folder called `.vscode` in the project root, and inside it a file called `settings.json`:

**Windows (PowerShell)**

```powershell
New-Item -ItemType Directory -Force -Path .vscode | Out-Null
New-Item -ItemType File -Path .vscode/settings.json
```

**macOS / Linux (Terminal)**

```bash
mkdir -p .vscode
touch .vscode/settings.json
```

Put this inside `.vscode/settings.json`:

```json
{
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.formatOnSave": true,
  "[prisma]": {
    "editor.defaultFormatter": "Prisma.prisma"
  }
}
```

Now VS Code formats each file with Prettier every time you press **Ctrl+S** (Windows/Linux) or **Cmd+S** (macOS). Prisma files are formatted by the Prisma extension.

---

## 8. Create .gitignore

`.gitignore` tells Git which files must **never** be saved into the repository. Create `.gitignore` in the project root:

```gitignore
# Dependencies: reinstalled with `npm install`
node_modules/

# Build output: recreated with `npm run build`
dist/

# Secrets: NEVER commit these
.env
.env.*
!.env.example

# Logs
*.log
npm-debug.log*

# Generated Prisma client: recreated with `npm run db:generate`
src/generated/

# Editor / OS clutter
.vscode/*
!.vscode/settings.json
.idea/
.DS_Store
Thumbs.db
```

- `node_modules/`, `dist/` and `src/generated/` can be **recreated** with a command, so there is no reason to store them.
- `.env` contains **passwords**. If it is ever pushed to GitHub, anyone who sees it can access your database. The `!.env.example` line means "but DO keep `.env.example`", since it holds no secrets.
- `.vscode/*` ignores personal editor files, but `!.vscode/settings.json` keeps the shared settings file from Step 7.3.

---

## 9. Create the database on Neon

1. Log in to <https://console.neon.tech>.
2. Click **New Project**.
3. Give it a name (for example your project name), choose the **latest PostgreSQL version**, and pick the **region closest to your users**. Click **Create**.
4. On the project dashboard, click the **Connect** button. A window shows your **connection string**. It looks like this:

   ```
   postgresql://neondb_owner:abc123@ep-cool-name-123456-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require
   ```

5. In that window there is a **Connection pooling** switch. You need **two** connection strings:

| Switch           | The address contains | Copy it into   | Used by                                  |
| ---------------- | -------------------- | -------------- | ---------------------------------------- |
| **ON** (pooled)  | `-pooler`            | `DATABASE_URL` | our running app                          |
| **OFF** (direct) | no `-pooler`         | `DIRECT_URL`   | Prisma CLI commands (migrations, studio) |

Copy both strings somewhere safe for a minute. You will paste them in the next step.

> **Why two connection strings?**
> A **pooled** connection shares a small number of real database connections between many requests. That is what a busy web server needs.
> **Migrations** need a **direct** connection, because they change the database structure and must not go through the pool.

> ⚠️ The connection string contains the database **password**. Never paste it into chat, documents, screenshots or code. It only goes into your `.env` file.

---

## 10. Create the environment files (.env)

Settings that change between computers (database address, port, …) or that are secret (passwords) are **not** written in the code. They live in a file called `.env`.

### 10.1 Create `.env.example` (the template, safe to commit)

Create `.env.example` in the project root:

```bash
NODE_ENV=development
PORT=8080
LOG_LEVEL=debug

# Neon: POOLED connection (host contains "-pooler"), used by the app at runtime
DATABASE_URL=

# Neon: DIRECT connection (no "-pooler"), used by the Prisma CLI for migrations
DIRECT_URL=

# Comma-separated list of frontend origins allowed to call this API
CORS_ORIGINS=http://localhost:3000
```

This file shows **which** settings exist, with the secret values left empty. A new developer copies it to create their own `.env`.

### 10.2 Create your real `.env`

**Windows (PowerShell)**

```powershell
Copy-Item .env.example .env
```

**macOS / Linux (Terminal)**

```bash
cp .env.example .env
```

Open `.env` and paste your two Neon connection strings:

```bash
DATABASE_URL=postgresql://...-pooler.../neondb?sslmode=require
DIRECT_URL=postgresql://.../neondb?sslmode=require
```

**What each setting means:**

| Variable       | Meaning                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`     | `development` on your computer, `production` on the live server, `test` for automated tests.                                                  |
| `PORT`         | The port the server listens on. With `8080`, the API is at `http://localhost:8080`.                                                           |
| `LOG_LEVEL`    | How much to log: `trace` (everything) → `debug` → `info` → `warn` → `error` → `fatal` (least). Optional.                                      |
| `DATABASE_URL` | The **pooled** Neon connection string.                                                                                                        |
| `DIRECT_URL`   | The **direct** Neon connection string.                                                                                                        |
| `CORS_ORIGINS` | The frontend address(es) allowed to call this API. Separate several with commas, for example `http://localhost:3000,https://app.example.com`. |

**Check:** `.env` must **not** appear in Git's list of files:

**Windows (PowerShell)**

```powershell
git status
```

**macOS / Linux (Terminal)**

```bash
git status
```

You should see `.env.example` in the list but **not** `.env`. If `.env` appears, your `.gitignore` is wrong. Fix it before continuing.

---

## 11. Create the folder structure

**Windows (PowerShell)**

```powershell
New-Item -ItemType Directory -Force -Path src/config, src/lib, src/middlewares, src/utils, src/validators, src/services, src/controllers, src/routes, prisma | Out-Null
```

**macOS / Linux (Terminal)**

```bash
mkdir -p src/config src/lib src/middlewares src/utils src/validators src/services src/controllers src/routes prisma
```

**What each folder is for:**

| Folder            | Holds                                                                                                            |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `src/config`      | App configuration (reading `.env`).                                                                              |
| `src/lib`         | Shared "single instance" objects: the logger and the database client.                                            |
| `src/middlewares` | Functions that run in the middle of handling a request (404 handler, error handler, and later things like auth). |
| `src/utils`       | Small helper functions and classes used everywhere.                                                              |
| `src/validators`  | Zod schemas: the rules for what valid input looks like.                                                          |
| `src/services`    | Business logic and database calls. **No** `req` / `res` here.                                                    |
| `src/controllers` | Read the request, call the service, send the response.                                                           |
| `src/routes`      | Connect URLs (like `GET /api/users`) to controllers.                                                             |
| `prisma`          | The database schema and migrations.                                                                              |

> **Rule of thumb:** controllers deal with **HTTP**; services deal with **business logic and data**. Keeping them separate makes the code easy to test and reuse.

---

## 12. Environment config

**File: `src/config/env.ts`**

This file reads the values from `.env`, **checks** that they are valid, and exports them. If something is missing or wrong, the app refuses to start and prints a clear message. It is much better to fail immediately than to crash later in a confusing way.

```ts
import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace"])
    .optional(),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1, "DIRECT_URL is required"),

  CORS_ORIGINS: z
    .string()
    .default("http://localhost:3000")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean)
    ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // The logger depends on env, so plain console is the only option here.
  console.error("❌ Invalid environment variables:\n");
  console.error(z.prettifyError(parsed.error));
  process.exit(1);
}

export const env = parsed.data;

export const isDev = env.NODE_ENV === "development";
export const isProd = env.NODE_ENV === "production";
```

**Line by line:**

- `import "dotenv/config"` loads `.env` into `process.env`.
- `z.object({...})` describes what a valid environment looks like.
- `z.coerce.number()`: everything in `.env` is text, so this turns `"8080"` into the number `8080`.
- `.default(...)` is the value used when the variable is missing.
- `.transform(...)` turns `"a.com, b.com"` into the array `["a.com", "b.com"]`.
- `safeParse` checks the data **without throwing**. If it fails, we print the problems and stop the app with `process.exit(1)` (`1` means "exited with an error").
- From now on, **always use `env.PORT`, never `process.env.PORT`**. `env` is checked and correctly typed.

> **About `.js` in imports.** In the next files you will see imports like `import { env } from "../config/env.js";`, even though the file is `env.ts`. This is **correct and required**. TypeScript compiles `env.ts` into `env.js`, and Node needs the real file name at runtime. **Always write `.js` when importing your own files.** If you forget, you get an `ERR_MODULE_NOT_FOUND` error.

---

## 13. Logger

**File: `src/lib/logger.ts`**

We use **pino** instead of `console.log`. It is fast, it supports log levels (debug / info / warn / error), it can hide secrets, and in production it writes JSON that log tools can search.

```ts
import { pino } from "pino";
import { env, isDev } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL ?? (isDev ? "debug" : "info"),

  // Never write secrets to logs.
  // Each "*" matches exactly one level, so list every depth we care about.
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "password",
      "token",
      "*.password",
      "*.token",
      "*.*.password",
      "*.*.token",
    ],
    censor: "[REDACTED]",
  },

  // Human-readable output in development; raw JSON in production
  // (log platforms parse the JSON).
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:HH:MM:ss",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});
```

**What it does:**

- `level`: uses `LOG_LEVEL` from `.env` if set. Otherwise it shows `debug` and above in development and `info` and above in production.
- `redact`: any field named `password` or `token` is replaced with `[REDACTED]` in the logs. Each `*` stands for **exactly one level** of nesting:
  - `password` → `{ password }`
  - `*.password` → `{ body: { password } }`
  - `*.*.password` → `{ req: { body: { password } } }`

  That is why all three depths are listed. The `authorization` and `cookie` request headers are hidden too, because they carry login tokens.

- `transport: pino-pretty`: only in development, it makes logs coloured and readable.

**How to use it anywhere in the code:**

```ts
logger.info("Something normal happened");
logger.warn({ userId }, "Something odd happened");
logger.error({ err }, "Something failed");
```

---

## 14. Prisma: schema, config and first migration

**Prisma** is an **ORM**: you describe your tables in a file, and Prisma creates the tables in the database and gives you type-safe functions such as `prisma.user.findMany()`. You never write raw SQL for normal work.

### 14.1 Create the schema

**File: `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}

// Example model: used to test the setup. Replace with your real models later.
model User {
  id        String   @id @default(uuid())
  email     String   @unique
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@map("users")
}
```

- `generator client`: tells Prisma to generate the TypeScript client code into `src/generated/prisma`.
- `datasource db`: we use PostgreSQL. The connection address is **not** written here; it comes from `prisma.config.ts` (next step).
- `model User` describes a table:
  - `@id @default(uuid())`: the primary key, filled automatically with a random unique ID.
  - `@unique`: no two users can have the same email.
  - `String?`: the `?` means the field is optional (can be empty / `null`).
  - `@default(now())`: filled with the current time when the row is created.
  - `@updatedAt`: updated automatically every time the row changes.
  - `@@map("users")`: the model is called `User` in code, but the real table is named `users`.

### 14.2 Create the Prisma config

**File: `prisma.config.ts`** (in the project root, **not** inside `prisma/`)

```ts
import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // CLI commands (migrate, studio) use the DIRECT (non-pooled) connection.
    url: process.env.DIRECT_URL!,
  },
});
```

This tells the **Prisma command-line tool** where the schema is, where to put migrations, and which database to connect to (the **direct** URL). The `!` after `DIRECT_URL` tells TypeScript "trust me, this value exists".

### 14.3 Create the first migration

A **migration** is a SQL file that changes the database structure (creates a table, adds a column, …). Prisma writes it for you by comparing `schema.prisma` with the database.

**Windows (PowerShell)**

```powershell
npm run db:migrate -- --name init
```

**macOS / Linux (Terminal)**

```bash
npm run db:migrate -- --name init
```

- The `--` passes `--name init` through npm to Prisma. `init` is the name of this migration.
- Prisma creates the file `prisma/migrations/<date>_init/migration.sql` and runs it on your Neon database. The `users` table now exists.

> **Always give migrations a short name that describes the change**, for example `add_products_table` or `add_phone_to_users`.

### 14.4 Generate the Prisma client

**Windows (PowerShell)**

```powershell
npm run db:generate
```

**macOS / Linux (Terminal)**

```bash
npm run db:generate
```

This creates the folder `src/generated/prisma`, with all the TypeScript code needed to talk to your tables.

> **Run `npm run db:generate` after every change to `schema.prisma`.** Prisma 7 does **not** do it automatically after a migration. If you forget, your code will not see the new tables or columns.
> **Never edit anything inside `src/generated/`.** It is overwritten every time you generate.

### 14.5 Add the `postinstall` script

Open `package.json` and add one line inside `"scripts"`, right after `"typecheck"`:

```json
    "typecheck": "tsc --noEmit",
    "postinstall": "prisma generate",
```

**Why:** `src/generated/` is in `.gitignore`, so it is **not** in Git. When someone else clones the project and runs `npm install`, npm automatically runs the `postinstall` script afterwards, and the Prisma client is generated for them. Without this line, their project would not compile until they remembered to run `npm run db:generate` themselves.

(We did not add this line in Step 4 because `npm install` would have failed then: the Prisma schema did not exist yet.)

**Check:** in your Neon dashboard, open **Tables** (or run `npm run db:studio`). You should see an empty `users` table.

---

## 15. Prisma client

**File: `src/lib/prisma.ts`**

This creates **one** database client that the whole app shares.

```ts
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "../generated/prisma/client.js";
import { env, isDev } from "../config/env.js";

// Runtime uses the POOLED connection string.
const adapter = new PrismaNeon({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({
  adapter,
  log: isDev ? ["warn", "error"] : ["error"],
});
```

- The **app** connects with the **pooled** URL (`DATABASE_URL`), through Neon's adapter.
- `log`: Prisma prints warnings and errors in development, and only errors in production.
- **Always import `prisma` from this file.** Never write `new PrismaClient()` anywhere else. Every extra client opens extra database connections.

---

## 16. Helper utilities

### 16.1 Error classes

**File: `src/utils/errors.ts`**

Instead of sending error responses by hand everywhere, we **throw** one of these errors. The error handler (Step 17) catches it and sends the right response.

```ts
/**
 * Base class for every error we throw on purpose.
 * Its `message` is safe to show to the client; the error handler sends it as-is.
 * Anything that is NOT an AppError is treated as an unexpected bug (500).
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode = 500,
    code = "INTERNAL_SERVER_ERROR",
    details?: unknown
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super(message, 400, "VALIDATION_ERROR", details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(message, 401, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this") {
    super(message, 403, "FORBIDDEN");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Resource not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ConflictError extends AppError {
  constructor(message = "Resource already exists") {
    super(message, 409, "CONFLICT");
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests, please try again later") {
    super(message, 429, "TOO_MANY_REQUESTS");
  }
}
```

| Class                  | HTTP status           | Use it when…                                       |
| ---------------------- | --------------------- | -------------------------------------------------- |
| `ValidationError`      | 400 Bad Request       | The input data is wrong.                           |
| `UnauthorizedError`    | 401 Unauthorized      | The user is not logged in.                         |
| `ForbiddenError`       | 403 Forbidden         | The user is logged in but not allowed to do this.  |
| `NotFoundError`        | 404 Not Found         | The thing they asked for does not exist.           |
| `ConflictError`        | 409 Conflict          | It already exists (for example a duplicate email). |
| `TooManyRequestsError` | 429 Too Many Requests | They are sending requests too fast.                |

**Example:** `throw new NotFoundError("Product not found");`

> **Important:** the `message` of these errors **is shown to the user**, so never put secrets or technical details in it.

### 16.2 Standard success response

**File: `src/utils/apiResponse.ts`**

Every successful response uses the same shape, so the frontend always knows where to find the data.

```ts
import type { Response } from "express";

export interface ApiSuccessResponse<T> {
  success: true;
  message?: string;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Send a successful JSON response in the standard envelope.
 *
 * @param meta optional extras such as pagination ({ page, limit, total }).
 */
export function sendSuccess<T>(
  res: Response,
  statusCode: number,
  data: T,
  message?: string,
  meta?: Record<string, unknown>
): void {
  const body: ApiSuccessResponse<T> = {
    success: true,
    ...(message !== undefined && { message }),
    data,
    ...(meta !== undefined && { meta }),
  };

  res.status(statusCode).json(body);
}
```

**Every response from our API looks like one of these:**

```json
{ "success": true, "message": "User created", "data": { "id": "..." } }
```

```json
{
  "success": false,
  "error": { "code": "NOT_FOUND", "message": "User not found" }
}
```

**Usage in a controller:** `sendSuccess(res, 200, users);` or `sendSuccess(res, 201, user, "User created");`

### 16.3 Async handler

**File: `src/utils/asyncHandler.ts`**

Most of our route handlers are `async` because they wait for the database. This wrapper makes sure that if an async handler fails, the error goes to our error handler.

```ts
import type { NextFunction, Request, RequestHandler, Response } from "express";

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/**
 * Wraps an async route handler so a rejected promise reaches the error handler.
 *
 * Express 5 already forwards async errors on its own, so this is a safety net,
 * not a requirement. It keeps every handler consistent and makes the error
 * path explicit when someone reads the code.
 */
export const asyncHandler =
  (fn: AsyncRequestHandler): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
```

**Rule:** wrap **every** async route handler in `asyncHandler(...)`.

---

## 17. Middlewares: 404 and error handler

A **middleware** is a function that Express runs while handling a request. We need two special ones that run **at the end**.

### 17.1 Not-found handler

**File: `src/middlewares/notFound.ts`**

If a request reaches this point, no route matched the URL, so we create a 404 error.

```ts
import type { RequestHandler } from "express";
import { NotFoundError } from "../utils/errors.js";

/** Catches any request that matched no route. Mounted after all routers. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError(`Route ${req.method} ${req.originalUrl} not found`));
};
```

`next(error)` hands the error to the error handler. (The `_` in `_res` means "this parameter is not used".)

### 17.2 Error handler

**File: `src/middlewares/errorHandler.ts`**

This is the **single place** where any error becomes an HTTP response.

```ts
import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { logger } from "../lib/logger.js";
import { isProd } from "../config/env.js";
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../utils/errors.js";
import type { ApiErrorResponse } from "../utils/apiResponse.js";

/** Turns any thrown value into an AppError with the right status code. */
function normalizeError(err: unknown): AppError {
  // 1. Errors we threw on purpose.
  if (err instanceof AppError) return err;

  // 2. Zod validation failures (from schema.parse in a controller).
  if (err instanceof ZodError) {
    return new ValidationError(
      "Invalid request data",
      err.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }))
    );
  }

  // 3. Known Prisma errors that map cleanly onto HTTP statuses.
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002": // unique constraint violation
        return new ConflictError("A record with this value already exists");
      case "P2025": // record to update/delete not found
        return new NotFoundError("Record not found");
    }
  }

  // 4. express.json() errors: malformed JSON or an oversized body.
  if (typeof err === "object" && err !== null && "type" in err) {
    const type = (err as { type?: unknown }).type;
    if (type === "entity.parse.failed") {
      return new ValidationError("Malformed JSON in request body");
    }
    if (type === "entity.too.large") {
      return new AppError("Request body too large", 413, "PAYLOAD_TOO_LARGE");
    }
  }

  // 5. Anything else is a bug.
  const message = err instanceof Error ? err.message : "Unknown error";
  return new AppError(message, 500, "INTERNAL_SERVER_ERROR");
}

/**
 * The single place that turns errors into HTTP responses.
 * Must be registered LAST in app.ts, and must keep all four parameters:
 * that is how Express recognises it as an error handler.
 */
export const migrateerrorHandler: ErrorRequestHandler = (
  err,
  req,
  res,
  next
) => {
  // If the response has already started streaming, Express must close it.
  if (res.headersSent) {
    next(err);
    return;
  }

  const appError = normalizeError(err);
  const isServerError = appError.statusCode >= 500;

  const logContext = { err, method: req.method, url: req.originalUrl };
  if (isServerError) {
    logger.error(logContext, appError.message);
  } else {
    logger.warn(logContext, appError.message);
  }

  // Never leak internal error messages to clients in production.
  const message =
    isServerError && isProd
      ? "Something went wrong. Please try again later."
      : appError.message;

  const body: ApiErrorResponse = {
    success: false,
    error: {
      code: appError.code,
      message,
      ...(appError.details !== undefined && { details: appError.details }),
    },
  };

  res.status(appError.statusCode).json(body);
};
```

**How it works:**

`normalizeError` turns **any** kind of error into one of our `AppError`s:

| Error that happened                        | Becomes                                         |
| ------------------------------------------ | ----------------------------------------------- |
| One of our own errors (`NotFoundError`, …) | Used as it is.                                  |
| A Zod validation error                     | **400** with a list of which fields are wrong.  |
| Prisma `P2002` (duplicate unique value)    | **409 Conflict**                                |
| Prisma `P2025` (record not found)          | **404 Not Found**                               |
| Broken JSON in the request body            | **400**                                         |
| Request body too big (over 1 MB)           | **413**                                         |
| **Anything else**                          | **500**. This means there is a bug in our code. |

`errorHandler` then:

1. logs it (`error` level for 5xx, `warn` for 4xx),
2. **in production**, replaces 500 messages with a generic one, so internal details never reach users,
3. sends the standard error JSON.

> ⚠️ An error handler **must have exactly four parameters** `(err, req, res, next)`, even if you do not use `next`. That is how Express knows it is an error handler.

---

## 18. The example "users" feature

This small feature exists **only to test that the whole setup works**: routes → controller → validation → service → database → response → errors. When you build the real project, use it as the pattern for your own features, then remove it (see [Step 25](#25-how-to-add-a-new-feature-later)).

### 18.1 Validator

**File: `src/validators/user.schema.ts`**

Rules for what valid input looks like.

```ts
import { z } from "zod";

export const createUserSchema = z.object({
  email: z.email(),
  name: z.string().trim().min(1).max(100).optional(),
});

export const userIdParamSchema = z.object({
  id: z.uuid(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
```

- `createUserSchema`: `email` must be a valid email. `name` is optional, but if given it is trimmed and must be 1–100 characters.
- `userIdParamSchema`: the `:id` in the URL must be a valid UUID.
- `z.infer<...>` creates a TypeScript type **from** the schema, so the rules and the type can never disagree.

### 18.2 Service

**File: `src/services/user.service.ts`**

The business logic and the database calls. It knows nothing about HTTP.

```ts
import { prisma } from "../lib/prisma.js";
import { NotFoundError } from "../utils/errors.js";
import type { CreateUserInput } from "../validators/user.schema.js";

export async function listUsers() {
  return prisma.user.findMany({ orderBy: { createdAt: "desc" } });
}

export async function getUserById(id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new NotFoundError("User not found");
  return user;
}

export async function createUser(input: CreateUserInput) {
  // A duplicate email throws Prisma P2002, which errorHandler turns into 409.
  return prisma.user.create({ data: input });
}
```

Notice there are **no** `try/catch` blocks. Errors simply bubble up to the error handler. That is the point of having one.

### 18.3 Controller

**File: `src/controllers/user.controller.ts`**

Reads the request, validates it, calls the service and sends the response.

```ts
import { asyncHandler } from "../utils/asyncHandler.js";
import { sendSuccess } from "../utils/apiResponse.js";
import {
  createUserSchema,
  userIdParamSchema,
} from "../validators/user.schema.js";
import {
  createUser,
  getUserById,
  listUsers,
} from "../services/user.service.js";

export const listUsersHandler = asyncHandler(async (_req, res) => {
  const users = await listUsers();
  sendSuccess(res, 200, users);
});

export const getUserHandler = asyncHandler(async (req, res) => {
  // A ZodError thrown here becomes a 400 in errorHandler.
  const { id } = userIdParamSchema.parse(req.params);
  const user = await getUserById(id);
  sendSuccess(res, 200, user);
});

export const createUserHandler = asyncHandler(async (req, res) => {
  const input = createUserSchema.parse(req.body);
  const user = await createUser(input);
  sendSuccess(res, 201, user, "User created");
});
```

`schema.parse(...)` either returns clean, typed data or **throws** a `ZodError`, which the error handler turns into a 400 response.

> **Always validate with Zod before using `req.body`, `req.params` or `req.query`.** Never trust data that comes from outside.

### 18.4 Routes

**File: `src/routes/user.routes.ts`**

Connects URLs and HTTP methods to the controller functions.

```ts
import { Router } from "express";
import {
  createUserHandler,
  getUserHandler,
  listUsersHandler,
} from "../controllers/user.controller.js";

const router = Router();

router.get("/", listUsersHandler);
router.get("/:id", getUserHandler);
router.post("/", createUserHandler);

export default router;
```

**File: `src/routes/index.ts`**

Joins all feature routers together.

```ts
import { Router } from "express";
import userRoutes from "./user.routes.js";

const router = Router();

router.use("/users", userRoutes);
// Each new feature adds one line here:
// router.use("/products", productRoutes);

export default router;
```

Because `app.ts` (next step) mounts this router at `/api`, the final URLs are:

| Method | URL              | Handler        |
| ------ | ---------------- | -------------- |
| GET    | `/api/users`     | list all users |
| GET    | `/api/users/:id` | get one user   |
| POST   | `/api/users`     | create a user  |

---

## 19. The Express app

**File: `src/app.ts`**

Builds the Express application: adds the middlewares **in the right order**, the health check and the routes.

```ts
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import apiRoutes from "./routes/index.js";
import { notFoundHandler } from "./middlewares/notFound.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { asyncHandler } from "./utils/asyncHandler.js";
import { sendSuccess } from "./utils/apiResponse.js";

const app = express();

// Needed behind a reverse proxy / load balancer (Render, Railway, Cloud Run…)
// so req.ip and secure cookies work.
app.set("trust proxy", 1);

// ---- Security ----
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGINS,
    credentials: true,
  })
);

// ---- Body parsing ----
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// ---- Request logging (one line per request) ----
app.use(
  pinoHttp({
    logger,
    autoLogging: { ignore: (req) => req.url === "/health" },
  })
);

// ---- Health check: confirms the server AND the database are up ----
app.get(
  "/health",
  asyncHandler(async (_req, res) => {
    await prisma.$queryRaw`SELECT 1`;
    sendSuccess(res, 200, {
      status: "ok",
      database: "up",
      uptime: process.uptime(),
    });
  })
);

// ---- API routes ----
app.use("/api", apiRoutes);

// ---- 404, then the error handler: these two must stay LAST, in this order ----
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
```

**Each part, in order:**

| Part                              | What it does                                                                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `trust proxy`                     | When deployed behind a hosting provider's proxy, this lets us see the user's real IP address.                          |
| `helmet()`                        | Adds security headers to every response.                                                                               |
| `cors(...)`                       | Only the frontends listed in `CORS_ORIGINS` may call the API from a browser.                                           |
| `express.json(...)`               | Reads JSON request bodies into `req.body`. Bodies larger than 1 MB are rejected.                                       |
| `express.urlencoded(...)`         | Reads HTML form submissions into `req.body`.                                                                           |
| `pinoHttp(...)`                   | Logs one line per request (but not for `/health`, which would flood the logs).                                         |
| `/health`                         | Runs a tiny query (`SELECT 1`) to prove the database works. Hosting platforms call this URL to check the app is alive. |
| `/api`                            | All feature routes live under `/api`.                                                                                  |
| `notFoundHandler`, `errorHandler` | **Must be last, in this order.** Express runs middlewares from top to bottom.                                          |

> ⚠️ **Order matters.** If you put a route **after** `notFoundHandler`, it will never be reached.

---

## 20. The server

**File: `src/server.ts`**

Starts the HTTP server, and shuts it down safely when asked to stop.

```ts
import http from "node:http";
import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";

const server = http.createServer(app);

server.listen(env.PORT, () => {
  logger.info(
    `🚀 Server running on http://localhost:${env.PORT} (${env.NODE_ENV})`
  );
});

// ---- Graceful shutdown ----
// Stop accepting new connections, let in-flight requests finish,
// close the DB connection, then exit.
let isShuttingDown = false;

function shutdown(signal: string, exitCode = 0): void {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`${signal} received, shutting down gracefully...`);

  server.close(async (err) => {
    if (err) logger.error({ err }, "Error while closing HTTP server");

    await prisma.$disconnect();
    logger.info("Shutdown complete");
    process.exit(err ? 1 : exitCode);
  });

  // Force-exit if something hangs (e.g. a stuck keep-alive connection).
  setTimeout(() => {
    logger.error("Forced shutdown after 10s timeout");
    process.exit(1);
  }, 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// ---- Last-resort safety nets ----
process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  shutdown("unhandledRejection", 1);
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception, process state is unreliable");
  process.exit(1);
});
```

**What it does:**

- **Why separate `app.ts` and `server.ts`?** `app.ts` only **builds** the app; `server.ts` **starts** it. Later, automated tests can import `app` without starting a real server.
- **Graceful shutdown:** when you press **Ctrl+C** (`SIGINT`), or the hosting platform stops the app (`SIGTERM`), the server:
  1. stops accepting new requests,
  2. lets requests that are already running finish,
  3. closes the database connection,
  4. exits.

  If this takes longer than 10 seconds, it force-exits. (`.unref()` means "do not keep the app alive just for this timer".)

- **Safety nets:**
  - `unhandledRejection`: a promise failed and nobody caught it. We log it and shut down cleanly.
  - `uncaughtException`: a serious, unexpected error. The app may be in a broken state, so we log it and exit immediately. The hosting platform restarts the app. (Pino writes the final log line before the process exits, so it is not lost.)

---

## 21. Run it and test everything

### 21.1 Check the types

**Windows (PowerShell)**

```powershell
npm run typecheck
```

**macOS / Linux (Terminal)**

```bash
npm run typecheck
```

**Expected:** no output after the command line, meaning no errors. If you see errors, they show the file and line number. Fix them first.

### 21.2 Start the development server

**Windows (PowerShell)**

```powershell
npm run dev
```

**macOS / Linux (Terminal)**

```bash
npm run dev
```

**Expected:**

```
[12:00:00] INFO: 🚀 Server running on http://localhost:8080 (development)
```

Leave this terminal running. **Open a second terminal** (in VS Code click the **+** in the terminal panel) for the tests below.

> **Windows note:** in Windows PowerShell, `curl` is a **different program** with different options. Always type **`curl.exe`** (with `.exe`) as shown below.

### 21.3 Test 1: Health check → expect `200`

**Windows (PowerShell)**

```powershell
curl.exe -i http://localhost:8080/health
```

**macOS / Linux (Terminal)**

```bash
curl -i http://localhost:8080/health
```

**Expected:** `HTTP/1.1 200 OK` and

```json
{
  "success": true,
  "data": { "status": "ok", "database": "up", "uptime": 3.14 }
}
```

✅ The server and the database work.

### 21.4 Test 2: Create a user → expect `201`

**Windows (PowerShell)**

```powershell
'{"email":"test@example.com","name":"Test User"}' | curl.exe -i -X POST http://localhost:8080/api/users -H "Content-Type: application/json" --data-binary "@-"
```

**macOS / Linux (Terminal)**

```bash
curl -i -X POST http://localhost:8080/api/users -H "Content-Type: application/json" -d '{"email":"test@example.com","name":"Test User"}'
```

> **Why is the Windows command different?** PowerShell mangles quote marks inside arguments. So we "pipe" (`|`) the JSON into curl, and `--data-binary "@-"` tells curl to read the body from that pipe.

**Expected:** `HTTP/1.1 201 Created` and

```json
{"success":true,"message":"User created","data":{"id":"<some-uuid>","email":"test@example.com","name":"Test User",...}}
```

**Copy the `id` value.** You need it in Test 4.

✅ Routes, controller, validation, service and database writes all work.

### 21.5 Test 3: List users → expect `200`

**Windows (PowerShell)**

```powershell
curl.exe -i http://localhost:8080/api/users
```

**macOS / Linux (Terminal)**

```bash
curl -i http://localhost:8080/api/users
```

**Expected:** `200` and a `data` array containing your test user.

### 21.6 Test 4: Get one user → expect `200`

Replace `PASTE-ID-HERE` with the id from Test 2.

**Windows (PowerShell)**

```powershell
curl.exe -i http://localhost:8080/api/users/PASTE-ID-HERE
```

**macOS / Linux (Terminal)**

```bash
curl -i http://localhost:8080/api/users/PASTE-ID-HERE
```

**Expected:** `200` and the user.

### 21.7 Test 5: Duplicate email → expect `409`

Run **Test 2 again** with exactly the same command.

**Expected:** `HTTP/1.1 409 Conflict` and

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "A record with this value already exists"
  }
}
```

✅ Prisma errors are converted correctly.

### 21.8 Test 6: Invalid data → expect `400`

**Windows (PowerShell)**

```powershell
'{"email":"not-an-email"}' | curl.exe -i -X POST http://localhost:8080/api/users -H "Content-Type: application/json" --data-binary "@-"
```

**macOS / Linux (Terminal)**

```bash
curl -i -X POST http://localhost:8080/api/users -H "Content-Type: application/json" -d '{"email":"not-an-email"}'
```

**Expected:** `HTTP/1.1 400 Bad Request` and

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request data",
    "details": [{ "path": "email", "message": "Invalid email address" }]
  }
}
```

✅ Zod validation works.

### 21.9 Test 7: Invalid id → expect `400`

**Windows (PowerShell)**

```powershell
curl.exe -i http://localhost:8080/api/users/123
```

**macOS / Linux (Terminal)**

```bash
curl -i http://localhost:8080/api/users/123
```

**Expected:** `400` with `"message":"Invalid UUID"` in the details.

### 21.10 Test 8: Unknown URL → expect `404`

**Windows (PowerShell)**

```powershell
curl.exe -i http://localhost:8080/api/does-not-exist
```

**macOS / Linux (Terminal)**

```bash
curl -i http://localhost:8080/api/does-not-exist
```

**Expected:** `HTTP/1.1 404 Not Found` and

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Route GET /api/does-not-exist not found"
  }
}
```

✅ The 404 handler works.

### 21.11 Test 9: Graceful shutdown

Go back to the terminal running `npm run dev` and press **Ctrl+C**.

**Expected:** you see `SIGINT received, shutting down gracefully...` and then `Shutdown complete`.

> 🎉 **If all nine tests passed, your base is complete and working.**
>
> Prefer a visual tool? You can run the same requests in **Postman** or the **Thunder Client** VS Code extension. You can also see the data with `npm run db:studio`.

---

## 22. Format the code and build for production

### 22.1 Format everything with Prettier

**Windows (PowerShell)**

```powershell
npm run format
npm run format:check
```

**macOS / Linux (Terminal)**

```bash
npm run format
npm run format:check
```

**Expected:** `format:check` ends with `All matched files use Prettier code style!`

### 22.2 Build and run the production version

**Windows (PowerShell)**

```powershell
npm run build
npm start
```

**macOS / Linux (Terminal)**

```bash
npm run build
npm start
```

- `build` creates the `dist/` folder with plain JavaScript.
- `start` runs `dist/server.js`. Run the health check from Test 1 again to confirm it works, then press **Ctrl+C**.

> Because `NODE_ENV` in your `.env` is still `development`, the logs stay pretty. On a real server, `NODE_ENV` is set to `production`, and the logs become JSON.

---

## 23. Write the README

Every project needs a `README.md`. It is the first file people read on GitHub, and it tells a new developer how to run the project. Create `README.md` in the project root with this content, and change the name and description:

````markdown
# My Backend

Short description of what this API does.

## Tech stack

- Node.js 24+, TypeScript, Express 5
- PostgreSQL on Neon, with Prisma 7
- Zod (validation), Pino (logging), Prettier (formatting)

## Getting started

### 1. Requirements

- Node.js 24 or newer
- A Neon PostgreSQL database (pooled and direct connection strings)

### 2. Install

```bash
npm install
```

This also generates the Prisma client automatically.

### 3. Environment variables

Copy the template and fill in your values:

```bash
# macOS / Linux
cp .env.example .env

# Windows (PowerShell)
Copy-Item .env.example .env
```

| Variable       | Description                                                  |
| -------------- | ------------------------------------------------------------ |
| `NODE_ENV`     | `development`, `production` or `test`                        |
| `PORT`         | Port the server listens on (default `8080`)                  |
| `LOG_LEVEL`    | Optional: `fatal`, `error`, `warn`, `info`, `debug`, `trace` |
| `DATABASE_URL` | Neon **pooled** connection string (used by the app)          |
| `DIRECT_URL`   | Neon **direct** connection string (used by Prisma CLI)       |
| `CORS_ORIGINS` | Comma-separated list of allowed frontend URLs                |

### 4. Set up the database

```bash
npm run db:migrate
```

### 5. Run

```bash
npm run dev
```

The API runs at http://localhost:8080. Check http://localhost:8080/health.

## Scripts

| Command                | Description                                 |
| ---------------------- | ------------------------------------------- |
| `npm run dev`          | Start in development mode with auto-restart |
| `npm run build`        | Compile TypeScript to `dist/`               |
| `npm start`            | Run the compiled app                        |
| `npm run typecheck`    | Check types without building                |
| `npm run format`       | Format all files with Prettier              |
| `npm run format:check` | Check formatting without changing files     |
| `npm run db:generate`  | Regenerate the Prisma client                |
| `npm run db:migrate`   | Create and apply a migration (development)  |
| `npm run db:deploy`    | Apply migrations (production)               |
| `npm run db:studio`    | Open Prisma Studio                          |

## Project structure

```
src/
├── config/        environment variable loading and validation
├── controllers/   HTTP request/response handling
├── lib/           shared instances (logger, Prisma client)
├── middlewares/   404 and error handlers
├── routes/        URL → controller mapping
├── services/      business logic and database access
├── utils/         helpers (errors, responses, async wrapper)
├── validators/    Zod schemas
├── app.ts         Express app setup
└── server.ts      server start and graceful shutdown
```

## API response format

Success:

```json
{ "success": true, "message": "optional", "data": {}, "meta": {} }
```

Error:

```json
{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }
```
````

Then format it:

**Windows (PowerShell)**

```powershell
npm run format
```

**macOS / Linux (Terminal)**

```bash
npm run format
```

---

## 24. Make your first Git commit

### 24.1 Check what will be saved

**Windows (PowerShell)**

```powershell
git status
```

**macOS / Linux (Terminal)**

```bash
git status
```

**Make sure the list does NOT contain** `.env`, `node_modules/`, `dist/` or `src/generated/`. If any of them appear, fix `.gitignore` (Step 8) first.

It **should** contain: `.env.example`, `.gitignore`, `.prettierignore`, `.prettierrc`, `.vscode/settings.json`, `README.md`, `package.json`, `package-lock.json`, `prisma.config.ts`, `prisma/` (with the migration), `src/`, `tsconfig.json` and `tsconfig.build.json`.

### 24.2 Commit

**Windows (PowerShell)**

```powershell
git add .
git commit -m "Initial backend setup"
```

**macOS / Linux (Terminal)**

```bash
git add .
git commit -m "Initial backend setup"
```

### 24.3 (Optional) Push to GitHub

Create an **empty** repository on GitHub (do **not** add a README there, since you already have one), then run the commands GitHub shows you. They look like this:

**Windows (PowerShell)**

```powershell
git remote add origin https://github.com/<your-org>/<repo-name>.git
git push -u origin main
```

**macOS / Linux (Terminal)**

```bash
git remote add origin https://github.com/<your-org>/<repo-name>.git
git push -u origin main
```

---

## 25. How to add a new feature later

Every new feature follows the **same recipe** as the users example. Say you are adding **products**:

1. **Model:** add a `model Product { ... }` block to `prisma/schema.prisma`.
2. **Migration:** run it with a descriptive name.

   **Windows (PowerShell)**

   ```powershell
   npm run db:migrate -- --name add_products
   npm run db:generate
   ```

   **macOS / Linux (Terminal)**

   ```bash
   npm run db:migrate -- --name add_products
   npm run db:generate
   ```

3. **Validator:** `src/validators/product.schema.ts` with Zod schemas for the input.
4. **Service:** `src/services/product.service.ts` with the database calls and business rules. Throw `NotFoundError` etc. when needed.
5. **Controller:** `src/controllers/product.controller.ts`. Wrap each handler in `asyncHandler`, `parse` the input, call the service, then `sendSuccess`.
6. **Routes:** `src/routes/product.routes.ts` connecting URLs to the handlers.
7. **Mount it:** add `router.use("/products", productRoutes);` in `src/routes/index.ts`.
8. **Test it** with curl or Postman, including the error cases.
9. **Check:** `npm run typecheck` and `npm run format:check` both pass.

**When your project has its first real feature,** delete the example users feature:

- `src/validators/user.schema.ts`
- `src/services/user.service.ts`
- `src/controllers/user.controller.ts`
- `src/routes/user.routes.ts`
- the `router.use("/users", userRoutes);` line and its import in `src/routes/index.ts`
- the `User` model in `schema.prisma` (then run a migration)

(Or, if your project needs users, change the example into your real users feature.)

### Golden rules

1. **Never commit `.env`.**
2. Read settings from `env`, never from `process.env` directly.
3. Use `logger`, never `console.log`.
4. Validate **all** input with Zod.
5. Throw `AppError` subclasses; never build error responses by hand.
6. Respond with `sendSuccess`, so every response has the same shape.
7. Controllers do HTTP, services do logic. Never put `req` / `res` in a service.
8. Import your own files with the `.js` extension.
9. After changing `schema.prisma`, migrate **and** generate.
10. Run `npm run typecheck` and `npm run format:check` before every commit.

---

## Common problems and fixes

| Problem                                                         | Cause                                                                  | Fix                                                                                                                                                                  |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `❌ Invalid environment variables` when starting                | `.env` is missing, or a value is empty or wrong                        | Make sure `.env` exists in the project root and `DATABASE_URL` and `DIRECT_URL` are filled in. Read the message: it names the bad variable.                          |
| `Cannot find module '../generated/prisma/client.js'`            | The Prisma client has not been generated                               | Run `npm run db:generate`.                                                                                                                                           |
| `ERR_MODULE_NOT_FOUND` for one of your own files                | You forgot the `.js` at the end of an import                           | Write `from "./file.js"`, not `from "./file"`.                                                                                                                       |
| New table or column "does not exist" in TypeScript              | You changed the schema but did not regenerate                          | Run `npm run db:generate`.                                                                                                                                           |
| `Error: listen EADDRINUSE: address already in use :::8080`      | Another program (maybe another copy of this server) is using port 8080 | Stop the other program, or change `PORT` in `.env`.                                                                                                                  |
| `/health` returns `500`                                         | The database is unreachable                                            | Check `DATABASE_URL`. Make sure the Neon project is not deleted or suspended. The first request after a long idle period can be slow while Neon wakes up; try again. |
| Migration fails to connect or hangs                             | `DIRECT_URL` is wrong, or you used the pooled URL                      | `DIRECT_URL` must be the string **without** `-pooler`.                                                                                                               |
| Windows: `npm : ... running scripts is disabled on this system` | PowerShell's script policy blocks npm                                  | Run once: `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, answer `Y`, and open a new terminal.                                                                |
| Windows: `curl` shows strange errors about `-H` or `-X`         | `curl` in PowerShell is a different command                            | Use `curl.exe`, exactly as in Step 21.                                                                                                                               |
| Windows: JSON body error when testing POST                      | Quotes got mangled                                                     | Use the pipe form from Step 21.4: `'{...}' \| curl.exe ... --data-binary "@-"`.                                                                                      |
| `format:check` lists files                                      | Those files are not formatted                                          | Run `npm run format`, or turn on format-on-save (Step 7.3).                                                                                                          |
| `npm install` says `found N vulnerabilities`                    | A package has a known security issue                                   | **Do not run `npm audit fix --force`.** It can install breaking versions. Tell your team lead, who decides when and how to upgrade.                                  |
| `npm install` fails on `postinstall`                            | `prisma/schema.prisma` or `prisma.config.ts` is missing or broken      | Make sure both files exist and match Step 14.                                                                                                                        |
| Server does not restart when you save                           | The `dev` script is not running, or there is a syntax error            | Look at the `npm run dev` terminal for the error message.                                                                                                            |

---

## Final checklist

Tick every box before you start building features:

- [ ] `node -v` shows 24 or newer
- [ ] `npm run typecheck` shows no errors
- [ ] `npm run format:check` passes
- [ ] `npm run dev` starts the server
- [ ] `/health` returns `200` with `"database":"up"`
- [ ] All nine tests in Step 21 give the expected results
- [ ] `npm run build` then `npm start` works
- [ ] `README.md` is written and has your project's name
- [ ] `.env` is **not** in `git status`
- [ ] First commit is done

**Your base is ready. Build great things on it! 🚀**
