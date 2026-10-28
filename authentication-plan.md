# OrionKids Backend - Authentication & API Specification

This document details the authentication architecture, security policies, and all API endpoints implemented for the OrionKids backend.

---

## 1. Architecture & Security Model

### Stack & Integrations

- **Framework**: Express 5 on Node.js (>=24, ESM, `moduleResolution: nodenext`).
- **Authentication Engine**: [Better Auth](https://www.better-auth.com/) (`1.7.13`) with Prisma PostgreSQL adapter.
- **Database**: PostgreSQL (Neon Serverless) via `@prisma/adapter-neon` and Prisma Client 7.
- **Layering**: `Validators (Zod 4) -> Services -> Controllers -> Routers`.

### Identity & Lifecycle Model

1. **Roles**:
   - `USER`: Regular customer/parent account.
   - `ADMIN`: Administrator with access to the review queue and moderation endpoints.
2. **Account Statuses**:
   - `PENDING`: Default state upon sign-up. The user can log in, fetch `GET /api/me`, and logout. Protected feature routes (`requireActive`) return `403 ACCOUNT_PENDING`.
   - `ACTIVE`: Approved account with full access to feature routes.
   - `RESTRICTED`: Suspended account. Login is blocked at session creation (`403 ACCOUNT_RESTRICTED`). Restricting an existing user immediately purges all active database sessions.

### Security Guarantees

- **Server Authority**: Fields `role` and `status` have `input: false` on Better Auth additional fields. Client payloads cannot set or tamper with them.
- **No Cookie Cache**: `cookieCache` is disabled. The auth middleware fetches the user's fresh `role` and `status` from the database on every protected request.
- **Audit Logging**: Every status change by an administrator emits a structured Pino log (`admin.user_status_changed`).
- **Data Redaction**: Sensitive headers (`req.headers.cookie`, `req.headers.authorization`, `res.headers["set-cookie"]`) and credential fields are redacted from logs.
- **Self-Modification Guard**: Administrators are strictly prevented from changing their own account status.

---

## 2. Global Middleware Pipeline

All requests flow through Express in the following order:

```text
Trust Proxy 1
  └── Helmet (Security Headers)
       └── CORS (Credentials allowed, explicit origins from CORS_ORIGINS)
            └── Better Auth Route Handler [app.all("/api/auth/*splat", toNodeHandler(auth))]
                 └── Body Parsers [express.json({ limit: "1mb" }), express.urlencoded]
                      └── Pino HTTP Logger (with sensitive field redaction)
                           └── /health Route
                                └── /api Application Routes
                                     └── 404 notFoundHandler
                                          └── errorHandler (AppError taxonomy)
```

---

## 3. Endpoints Directory

### 3.1. System & Health

#### `GET /health`

- **Access**: Public
- **Description**: Verifies the HTTP server and database connectivity via `SELECT 1`.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "status": "ok",
      "database": "up",
      "uptime": 12.34
    }
  }
  ```

---

### 3.2. Better Auth Endpoints (`/api/auth/*`)

Handled directly by Better Auth before body parsers.

#### `POST /api/auth/sign-up/email`

- **Access**: Public
- **Description**: Registers a new user. Initializes `role = USER` and `status = PENDING`.
- **Request Body**:
  ```json
  {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "password": "securePassword123"
  }
  ```
- **Response** (`200 OK`):
  - Sets HTTP-only session cookie (`better-auth.session_token`, `SameSite=Lax`).
  - Returns:
    ```json
    {
      "token": "session_token_string",
      "user": {
        "id": "usr_abc123",
        "name": "Jane Doe",
        "email": "jane@example.com",
        "emailVerified": false,
        "image": null,
        "role": "USER",
        "status": "PENDING",
        "createdAt": "2026-10-26T17:10:54.095Z",
        "updatedAt": "2026-10-26T17:10:54.095Z"
      }
    }
    ```

#### `POST /api/auth/sign-in/email`

- **Access**: Public
- **Description**: Authenticates user by email and password.
- **Request Body**:
  ```json
  {
    "email": "jane@example.com",
    "password": "securePassword123"
  }
  ```
- **Response (`200 OK`)**:
  - Sets HTTP-only session cookie.
  - Returns session token and user profile.
- **Response if Restricted (`403 Forbidden`)**:
  ```json
  {
    "code": "ACCOUNT_RESTRICTED",
    "message": "Your account is restricted"
  }
  ```

#### `POST /api/auth/sign-out`

- **Access**: Public / Authenticated
- **Description**: Invalidates the current session in the database and clears the session cookie.
- **Response** (`200 OK`):
  ```json
  {
    "success": true
  }
  ```

#### `GET /api/auth/get-session`

- **Access**: Authenticated (via cookie or bearer header)
- **Description**: Returns Better Auth session data and user identity.

#### Social Login (Google OAuth)

- Available at `/api/auth/sign-in/social` when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are configured.
- Protected by the same database hook blocking session creation for `RESTRICTED` users.

---

### 3.3. Current User Endpoint (`/api/me`)

#### `GET /api/me`

- **Access**: Authenticated (`requireAuth`)
- **Allowed States**: `PENDING`, `ACTIVE`
- **Description**: Returns the authenticated user's profile and review status. Sensitive credentials and password hashes are never returned.
- **Headers**:
  ```http
  Cookie: better-auth.session_token=<token>
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": {
      "id": "usr_abc123",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "image": null,
      "role": "USER",
      "status": "PENDING",
      "restrictedReason": null
    }
  }
  ```
- **Error Responses**:
  - `401 Unauthorized` (`code: UNAUTHENTICATED`): Session missing or expired.

---

### 3.4. Admin Review & Moderation Endpoints (`/api/admin/*`)

All routes under `/api/admin` are guarded by `requireAdmin` (`requireAuth` -> `requireActive` -> `roleCheck`).

#### `GET /api/admin/users`

- **Access**: Admin only (`requireAdmin`)
- **Description**: Paginated queue for reviewing registered users, ordered by `createdAt desc`.
- **Query Parameters**:
  | Parameter | Type    | Required | Default | Description                                    |
  | --------- | ------- | -------- | ------- | ---------------------------------------------- |
  | `page`    | Integer | No       | `1`     | Page number (min: 1)                           |
  | `limit`   | Integer | No       | `10`    | Page size (min: 1, max: 50)                    |
  | `status`  | String  | No       | —       | Filter by `PENDING`, `ACTIVE`, or `RESTRICTED` |
- **Example Request**:
  ```http
  GET /api/admin/users?status=PENDING&page=1&limit=10
  ```
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "data": [
      {
        "id": "usr_abc123",
        "name": "Jane Doe",
        "email": "jane@example.com",
        "image": null,
        "role": "USER",
        "status": "PENDING",
        "restrictedReason": null,
        "reviewedAt": null,
        "reviewedById": null,
        "createdAt": "2026-10-26T17:10:54.095Z",
        "updatedAt": "2026-10-26T17:10:54.095Z"
      }
    ],
    "meta": {
      "page": 1,
      "limit": 10,
      "total": 1,
      "totalPages": 1
    }
  }
  ```

#### `PATCH /api/admin/users/:id/status`

- **Access**: Admin only (`requireAdmin`)
- **Description**: Approve a user (`ACTIVE`) or restrict a user (`RESTRICTED`). Restricting a user automatically invalidates all their active sessions.
- **URL Parameters**:
  - `id`: Target user ID.
- **Request Body**:
  ```json
  {
    "status": "ACTIVE"
  }
  ```
  _Or when restricting:_
  ```json
  {
    "status": "RESTRICTED",
    "reason": "Suspicious login patterns observed."
  }
  ```
- **Validation Rules**:
  - `status`: Must be `"ACTIVE"` or `"RESTRICTED"`.
  - `reason`: Required when `status === "RESTRICTED"` (3 to 500 characters). Optional and cleared to `null` when approving.
- **Response** (`200 OK`):
  ```json
  {
    "success": true,
    "message": "User status updated successfully",
    "data": {
      "id": "usr_abc123",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "image": null,
      "role": "USER",
      "status": "ACTIVE",
      "restrictedReason": null,
      "reviewedAt": "2026-10-26T17:15:47.232Z",
      "reviewedById": "usr_admin_999",
      "createdAt": "2026-10-26T17:10:54.095Z",
      "updatedAt": "2026-10-26T17:15:47.253Z"
    }
  }
  ```
- **Error Responses**:
  - `400 Bad Request` (`code: VALIDATION_ERROR`): Reason omitted when restricting.
  - `403 Forbidden` (`code: FORBIDDEN`): Admin attempts to modify their own account status.
  - `404 Not Found` (`code: NOT_FOUND`): Target user does not exist.

---

## 4. Standard Response & Error Envelopes

### Success Envelope

```json
{
  "success": true,
  "message": "Optional human-readable confirmation",
  "data": { ... },
  "meta": { ... }
}
```

### Error Envelope

```json
{
  "success": false,
  "error": {
    "code": "STRING_ERROR_CODE",
    "message": "Safe human-readable message",
    "details": [ ... ]
  }
}
```

### Common Error Codes

| HTTP Code | Error Code              | Description                                                          |
| --------- | ----------------------- | -------------------------------------------------------------------- |
| `400`     | `VALIDATION_ERROR`      | Request query, params, or body failed Zod validation                 |
| `401`     | `UNAUTHENTICATED`       | Missing, expired, or invalid session                                 |
| `403`     | `ACCOUNT_PENDING`       | Authenticated user is awaiting profile review                        |
| `403`     | `ACCOUNT_RESTRICTED`    | User is suspended from the platform                                  |
| `403`     | `FORBIDDEN`             | Authenticated user lacks `ADMIN` role or attempted self-modification |
| `404`     | `NOT_FOUND`             | Database record or route does not exist                              |
| `429`     | `TOO_MANY_REQUESTS`     | Rate limit exceeded                                                  |
| `500`     | `INTERNAL_SERVER_ERROR` | Unexpected server bug                                                |

---

## 5. Administrative Scripts

### Promote Admin Seed Script

To promote an existing registered user to `ADMIN` and activate their account:

```bash
npm run admin:make -- you@orionkids.com
```

**Effects**:

1. Sets `role = "ADMIN"`.
2. Sets `status = "ACTIVE"`.
3. Records `reviewedAt = new Date()`.
4. Deletes active sessions for that user so fresh role tokens are issued upon next login.
