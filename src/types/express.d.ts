import type { UserRole, UserStatus } from "../generated/prisma/client.js";

export interface AuthContext {
  userId: string;
  sessionId: string;
  role: UserRole;
  status: UserStatus;
}

declare global {
  namespace Express {
    interface Request {
      authCtx?: AuthContext;
    }
  }
}
