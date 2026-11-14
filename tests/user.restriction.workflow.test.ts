import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  setUserStatus,
  getAdminOverview,
} from "../src/services/admin.service.js";
import { checkAccountActive } from "../src/middlewares/auth.js";
import { ForbiddenError } from "../src/utils/errors.js";
import { errorHandler } from "../src/middlewares/errorHandler.js";
import { acceptUserTerms } from "../src/services/registration.service.js";
import { createChildProfile } from "../src/services/child.service.js";

describe("OrionKids — User Restriction & Unrestriction Lifecycle Suite", () => {
  const timestamp = Date.now();
  const adminId = `admin_restr_${timestamp}`;
  const targetUserId = `user_target_${timestamp}`;
  const otherUserId = `user_other_${timestamp}`;

  before(async () => {
    // 1. Create Administrator
    await prisma.user.create({
      data: {
        id: adminId,
        name: "Restr Admin",
        email: `admin_${timestamp}@orionkids.test`,
        role: "ADMIN",
        status: "ACTIVE",
      },
    });

    // 2. Create Target Normal User
    await prisma.user.create({
      data: {
        id: targetUserId,
        name: "Target Player",
        email: `target_${timestamp}@orionkids.test`,
        role: "USER",
        status: "ACTIVE",
      },
    });

    // 3. Create Another Active Normal User (to verify isolation)
    await prisma.user.create({
      data: {
        id: otherUserId,
        name: "Sibling Player",
        email: `other_${timestamp}@orionkids.test`,
        role: "USER",
        status: "ACTIVE",
      },
    });

    // 4. Create active sessions for both users
    await prisma.session.create({
      data: {
        id: `sess_target_${timestamp}`,
        userId: targetUserId,
        token: `tok_target_${timestamp}`,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    await prisma.session.create({
      data: {
        id: `sess_other_${timestamp}`,
        userId: otherUserId,
        token: `tok_other_${timestamp}`,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
  });

  after(async () => {
    await prisma.session.deleteMany({
      where: { userId: { in: [adminId, targetUserId, otherUserId] } },
    });
    await prisma.childProfile.deleteMany({
      where: { userId: { in: [adminId, targetUserId, otherUserId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [adminId, targetUserId, otherUserId] } },
    });
  });

  it("1. Admin restricts target user: PostgreSQL status becomes RESTRICTED and reason is persisted", async () => {
    const restrictionReason = "Suspicious multi-device activity during cognitive quest";
    const updated = await setUserStatus(adminId, targetUserId, {
      status: "RESTRICTED",
      reason: restrictionReason,
    });

    assert.equal(updated.id, targetUserId);
    assert.equal(updated.status, "RESTRICTED");
    assert.equal(updated.restrictedReason, restrictionReason);
    assert.equal(updated.reviewedById, adminId);
    assert.ok(updated.reviewedAt);

    // Verify in database directly
    const dbUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });
    assert.equal(dbUser?.status, "RESTRICTED");
    assert.equal(dbUser?.restrictedReason, restrictionReason);
  });

  it("2. User session record is preserved so the user can be authenticated and identified as RESTRICTED", async () => {
    const session = await prisma.session.findFirst({
      where: { userId: targetUserId },
    });
    assert.ok(session, "Session record must remain so request can be mapped to the restricted user");
  });

  it("3. checkAccountActive strictly rejects RESTRICTED user with ACCOUNT_RESTRICTED code", () => {
    const req: any = {
      authCtx: {
        userId: targetUserId,
        sessionId: `sess_target_${timestamp}`,
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
        assert.equal(err.message, "Your account access is currently restricted.");
        return true;
      }
    );
    assert.equal(nextCalled, false);
  });

  it("4. Centralized errorHandler formats ACCOUNT_RESTRICTED with status 403 and consistent contract", () => {
    const appError = new ForbiddenError(
      "Your account access is currently restricted.",
      "ACCOUNT_RESTRICTED"
    );

    let statusCode = 0;
    let responseBody: any = null;

    const res: any = {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (body: any) => {
            responseBody = body;
          },
        };
      },
    };

    const req: any = {
      method: "GET",
      originalUrl: "/api/quest/sessions/current",
      authCtx: { userId: targetUserId, status: "RESTRICTED" },
    };

    errorHandler(appError, req, res, () => {});

    assert.equal(statusCode, 403);
    assert.equal(responseBody.success, false);
    assert.equal(responseBody.code, "ACCOUNT_RESTRICTED");
    assert.equal(responseBody.message, "Your account access is currently restricted.");
    assert.deepEqual(responseBody.data, { status: "RESTRICTED" });
  });

  it("5. Protected business services reject RESTRICTED accounts (terms acceptance, child creation)", async () => {
    // Attempt to accept terms while restricted
    await assert.rejects(
      async () =>
        acceptUserTerms(targetUserId, {
          agree: true,
          termsVersion: "v1.0",
          privacyPolicyVersion: "v1.0",
        }),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "ACCOUNT_RESTRICTED");
        return true;
      }
    );

    // Attempt to create child profile while restricted
    await assert.rejects(
      async () =>
        createChildProfile(targetUserId, {
          childName: "Unauthorized Child",
          age: 7,
          language: "English",
          selectedClass: "Class 2",
          parentEmail: "parent@test.com",
          parentMobile: "9876543210",
          isGuardian: true,
        }),
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "ACCOUNT_RESTRICTED");
        return true;
      }
    );
  });

  it("6. Other active users and administrators remain completely unaffected", async () => {
    // Verify Other User status is still ACTIVE in PostgreSQL
    const otherUser = await prisma.user.findUnique({
      where: { id: otherUserId },
    });
    assert.equal(otherUser?.status, "ACTIVE");

    // checkAccountActive allows Other User
    const req: any = {
      authCtx: {
        userId: otherUserId,
        sessionId: `sess_other_${timestamp}`,
        role: "USER",
        status: otherUser!.status,
      },
    };
    let nextCalled = false;
    checkAccountActive(req, {} as any, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);

    // Admin overview reports correct counts
    const overview = await getAdminOverview();
    assert.ok(overview.accounts.restricted >= 1);
    assert.ok(overview.accounts.active >= 1);
  });

  it("7. Admin can unrestrict the user: restores ACTIVE status and clears restrictionReason", async () => {
    const unrestrictResult = await setUserStatus(adminId, targetUserId, {
      status: "ACTIVE",
    });

    assert.equal(unrestrictResult.status, "ACTIVE");
    assert.equal(unrestrictResult.restrictedReason, null);

    // Verify DB
    const dbUser = await prisma.user.findUnique({
      where: { id: targetUserId },
    });
    assert.equal(dbUser?.status, "ACTIVE");
    assert.equal(dbUser?.restrictedReason, null);

    // checkAccountActive now allows targetUser
    const req: any = {
      authCtx: {
        userId: targetUserId,
        sessionId: `sess_target_${timestamp}`,
        role: "USER",
        status: dbUser!.status,
      },
    };
    let nextCalled = false;
    checkAccountActive(req, {} as any, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
  });
});
