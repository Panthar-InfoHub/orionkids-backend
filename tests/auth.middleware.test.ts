import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkAccountActive, checkAdminRole } from "../src/middlewares/auth.js";
import { UnauthorizedError, ForbiddenError } from "../src/utils/errors.js";

describe("Authorization Middleware Unit Tests", () => {
  it("rejects when no authCtx is attached to request (unauthenticated)", () => {
    const req: any = {};
    const res: any = {};
    let nextCalled = false;

    assert.throws(
      () =>
        checkAccountActive(req, res, () => {
          nextCalled = true;
        }),
      (err: any) => {
        assert.ok(err instanceof UnauthorizedError);
        assert.equal(err.code, "UNAUTHENTICATED");
        return true;
      }
    );
    assert.equal(nextCalled, false);
  });

  it("rejects PENDING user with ACCOUNT_PENDING forbidden error", () => {
    const req: any = {
      authCtx: {
        userId: "user_pending_1",
        sessionId: "sess_1",
        role: "USER",
        status: "PENDING",
      },
    };
    const res: any = {};
    let nextCalled = false;

    assert.throws(
      () =>
        checkAccountActive(req, res, () => {
          nextCalled = true;
        }),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "ACCOUNT_PENDING");
        return true;
      }
    );
    assert.equal(nextCalled, false);
  });

  it("rejects RESTRICTED user with ACCOUNT_RESTRICTED forbidden error", () => {
    const req: any = {
      authCtx: {
        userId: "user_restricted_1",
        sessionId: "sess_2",
        role: "USER",
        status: "RESTRICTED",
      },
    };
    const res: any = {};
    let nextCalled = false;

    assert.throws(
      () =>
        checkAccountActive(req, res, () => {
          nextCalled = true;
        }),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "ACCOUNT_RESTRICTED");
        return true;
      }
    );
    assert.equal(nextCalled, false);
  });

  it("allows ACTIVE user to proceed to next()", () => {
    const req: any = {
      authCtx: {
        userId: "user_active_1",
        sessionId: "sess_3",
        role: "USER",
        status: "ACTIVE",
      },
    };
    const res: any = {};
    let nextCalled = false;

    checkAccountActive(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
  });

  it("rejects non-admin from admin endpoints", () => {
    const req: any = {
      authCtx: {
        userId: "user_active_1",
        sessionId: "sess_3",
        role: "USER",
        status: "ACTIVE",
      },
    };
    const res: any = {};
    let nextCalled = false;

    assert.throws(
      () =>
        checkAdminRole(req, res, () => {
          nextCalled = true;
        }),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "FORBIDDEN");
        return true;
      }
    );
    assert.equal(nextCalled, false);
  });

  it("allows ADMIN user to proceed through checkAdminRole", () => {
    const req: any = {
      authCtx: {
        userId: "admin_1",
        sessionId: "sess_4",
        role: "ADMIN",
        status: "ACTIVE",
      },
    };
    const res: any = {};
    let nextCalled = false;

    checkAdminRole(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, true);
  });
});
