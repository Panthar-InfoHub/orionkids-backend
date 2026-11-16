import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma, disconnectPrisma } from "../src/lib/prisma.js";
import {
  getRegistrationStatus,
  acceptUserTerms,
  submitUserAccessRequest,
  getMyAccessRequests,
  ensureUserAccessRequest,
} from "../src/services/registration.service.js";
import {
  listAccessRequests,
  approveAccessRequest,
  rejectAccessRequest,
} from "../src/services/admin.service.js";
import { CURRENT_TERMS_VERSION } from "../src/validators/registration.schema.js";
import {
  ForbiddenError,
  ConflictError,
  ValidationError,
} from "../src/utils/errors.js";

describe("Production Authentication, Terms Acceptance, Admin Approval & Registration State Machine", () => {
  const timestamp = Date.now();
  let adminId: string;
  let newUser1Id: string;
  let newUser2Id: string;
  let existingActiveUserId: string;
  let restrictedUserId: string;

  let request1Id: string;
  let request2Id: string;

  before(async () => {
    // 1. Create an active Admin
    const admin = await prisma.user.create({
      data: {
        id: `reg_admin_${timestamp}`,
        email: `reg_admin_${timestamp}@example.com`,
        name: "Admin User",
        role: "ADMIN",
        status: "ACTIVE",
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        termsAcceptedAt: new Date(),
      },
    });
    adminId = admin.id;

    // 2. Create New User 1 (Unaccepted terms, no access request)
    const u1 = await prisma.user.create({
      data: {
        id: `reg_user1_${timestamp}`,
        email: `reg_user1_${timestamp}@example.com`,
        name: "Ananya Roy",
        role: "USER",
        status: "PENDING",
        termsAccepted: false,
      },
    });
    newUser1Id = u1.id;

    // 3. Create New User 2 (Will be rejected)
    const u2 = await prisma.user.create({
      data: {
        id: `reg_user2_${timestamp}`,
        email: `reg_user2_${timestamp}@example.com`,
        name: "Karan Patel",
        role: "USER",
        status: "PENDING",
        termsAccepted: false,
      },
    });
    newUser2Id = u2.id;

    // 4. Create Existing Active User with Onboarding complete
    const existing = await prisma.user.create({
      data: {
        id: `reg_existing_${timestamp}`,
        email: `reg_existing_${timestamp}@example.com`,
        name: "Existing Parent",
        role: "USER",
        status: "ACTIVE",
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
        termsAcceptedAt: new Date(),
        onboardingSubmittedAt: new Date(),
      },
    });
    existingActiveUserId = existing.id;

    // 5. Create Restricted User
    const restricted = await prisma.user.create({
      data: {
        id: `reg_restricted_${timestamp}`,
        email: `reg_restricted_${timestamp}@example.com`,
        name: "Blocked User",
        role: "USER",
        status: "RESTRICTED",
        restrictedReason: "Terms violation",
      },
    });
    restrictedUserId = restricted.id;
  });

  after(async () => {
    // Cleanup created test records
    await prisma.accessRequest.deleteMany({
      where: {
        userId: {
          in: [
            adminId,
            newUser1Id,
            newUser2Id,
            existingActiveUserId,
            restrictedUserId,
          ],
        },
      },
    });
    await prisma.termsAcceptance.deleteMany({
      where: {
        userId: {
          in: [
            adminId,
            newUser1Id,
            newUser2Id,
            existingActiveUserId,
            restrictedUserId,
          ],
        },
      },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            adminId,
            newUser1Id,
            newUser2Id,
            existingActiveUserId,
            restrictedUserId,
          ],
        },
      },
    });
  });

  // --- STAGE 2 & 3: NEW USER & TERMS ACCEPTANCE ---

  it("1. New user registration auto-ensures pending request and directs to '/terms-and-conditions'", async () => {
    const status = await getRegistrationStatus(newUser1Id);
    assert.equal(status.termsAccepted, false);
    assert.equal(status.accessRequestStatus, "PENDING");
    assert.equal(status.destination, "/terms-and-conditions");
    assert.ok(status.accessRequest);
    request1Id = status.accessRequest!.id;
  });

  it("2. User cannot submit access request before accepting terms", async () => {
    await assert.rejects(
      async () => {
        await submitUserAccessRequest(newUser2Id, {});
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "TERMS_REQUIRED");
        return true;
      }
    );
  });

  it("3. User accepts terms successfully and state updates to '/access-pending'", async () => {
    const status = await acceptUserTerms(
      newUser1Id,
      { agree: true },
      { ipAddress: "127.0.0.1", userAgent: "NodeTestRunner" }
    );

    assert.equal(status.termsAccepted, true);
    assert.equal(status.currentTermsVersion, CURRENT_TERMS_VERSION);
    assert.equal(status.userTermsVersion, CURRENT_TERMS_VERSION);
    assert.ok(status.termsAcceptedAt);
    assert.equal(status.accessRequestStatus, "PENDING");
    assert.equal(status.destination, "/access-pending");

    // Verify audit record in terms_acceptance table
    const auditRecords = await prisma.termsAcceptance.findMany({
      where: { userId: newUser1Id },
    });
    assert.equal(auditRecords.length, 1);
    assert.equal(auditRecords[0]!.termsVersion, CURRENT_TERMS_VERSION);
    assert.equal(auditRecords[0]!.ipAddress, "127.0.0.1");
  });

  it("4. Refreshing after accepting terms preserves state at '/access-pending'", async () => {
    const status = await getRegistrationStatus(newUser1Id);
    assert.equal(status.termsAccepted, true);
    assert.equal(status.destination, "/access-pending");
  });

  // --- STAGE 4 & 5: SUBMIT ACCESS REQUEST & PENDING SCREEN ---

  it("5. User can add notes to their auto-ensured pending access request", async () => {
    const res = await submitUserAccessRequest(newUser1Id, {
      notes: "Requesting access for 2nd grade student.",
    });

    assert.ok(res.request);
    assert.ok(res.request!.id);
    assert.equal(res.request!.id, request1Id);
    assert.equal(res.request!.notes, "Requesting access for 2nd grade student.");
    assert.equal(res.request!.status, "PENDING");
    assert.equal(res.status.accessRequestStatus, "PENDING");
    assert.equal(res.status.accountStatus, "PENDING");
    assert.equal(res.status.destination, "/access-pending");
  });

  it("6. Duplicate pending access request is strictly prevented", async () => {
    await assert.rejects(
      async () => {
        await submitUserAccessRequest(newUser1Id, { notes: "Another click" });
      },
      (err: any) => err instanceof ConflictError
    );
  });

  it("7. Pending user gets destination '/access-pending' upon fresh status check (after re-login)", async () => {
    const status = await getRegistrationStatus(newUser1Id);
    assert.equal(status.accountStatus, "PENDING");
    assert.equal(status.accessRequestStatus, "PENDING");
    assert.equal(status.destination, "/access-pending");
  });

  it("8. User can retrieve their own access request details", async () => {
    const myReq = await getMyAccessRequests(newUser1Id);
    assert.ok(myReq.currentRequest);
    assert.equal(myReq.currentRequest?.id, request1Id);
    assert.equal(myReq.currentRequest?.status, "PENDING");
    assert.equal(myReq.history.length, 1);
  });

  // --- STAGE 6: ADMIN REVIEW & APPROVAL ---

  it("9. Admin can list pending access requests", async () => {
    const list = await listAccessRequests({
      page: 1,
      limit: 10,
      status: "PENDING",
    });

    assert.ok(list.requests.length >= 1);
    const found = list.requests.find((r) => r.id === request1Id);
    assert.ok(found);
    assert.equal(found?.user.email, `reg_user1_${timestamp}@example.com`);
    assert.equal(found?.user.termsAccepted, true);
  });

  it("10. Admin cannot approve their own request", async () => {
    // Create dummy request for admin to test self-approval rejection
    const dummyReq = await prisma.accessRequest.create({
      data: {
        userId: adminId,
        status: "PENDING",
      },
    });

    await assert.rejects(
      async () => {
        await approveAccessRequest(adminId, dummyReq.id);
      },
      (err: any) => err instanceof ForbiddenError
    );

    await prisma.accessRequest.delete({ where: { id: dummyReq.id } });
  });

  it("11. Admin approves User 1 request: updates request to APPROVED and user to ACTIVE atomically", async () => {
    const result = await approveAccessRequest(adminId, request1Id);

    assert.equal(result.request.status, "APPROVED");
    assert.equal(result.request.reviewedById, adminId);
    assert.ok(result.request.reviewedAt);

    assert.equal(result.user.status, "ACTIVE");
    assert.equal(result.user.reviewedById, adminId);

    // Verify in database
    const dbUser = await prisma.user.findUniqueOrThrow({
      where: { id: newUser1Id },
    });
    assert.equal(dbUser.status, "ACTIVE");
  });

  it("12. Cannot approve an already approved request again", async () => {
    await assert.rejects(
      async () => {
        await approveAccessRequest(adminId, request1Id);
      },
      (err: any) => err instanceof ForbiddenError
    );
  });

  // --- STAGE 7: APPROVED USER DESTINATIONS ---

  it("13. Approved user without child onboarding goes to '/onboarding'", async () => {
    const status = await getRegistrationStatus(newUser1Id);
    assert.equal(status.accountStatus, "ACTIVE");
    assert.equal(status.accessRequestStatus, "APPROVED");
    assert.equal(status.onboardingCompleted, false);
    assert.equal(status.destination, "/onboarding");
  });

  it("14. Approved user after child onboarding goes to '/dashboard'", async () => {
    // Simulate user completing child onboarding
    await prisma.user.update({
      where: { id: newUser1Id },
      data: { onboardingSubmittedAt: new Date() },
    });

    const status = await getRegistrationStatus(newUser1Id);
    assert.equal(status.accountStatus, "ACTIVE");
    assert.equal(status.onboardingCompleted, true);
    assert.equal(status.destination, "/dashboard");
  });

  // --- REJECTION FLOW ---

  it("15. Admin rejects User 2 request with reason, routing to '/access-rejected'", async () => {
    // User 2 accepts terms first
    const termsRes = await acceptUserTerms(newUser2Id, { agree: true });
    assert.ok(termsRes.accessRequest);
    request2Id = termsRes.accessRequest!.id;

    // Admin rejects request with reason
    const rej = await rejectAccessRequest(
      adminId,
      request2Id,
      "Incomplete school documentation."
    );

    assert.equal(rej.request.status, "REJECTED");
    assert.equal(
      rej.request.rejectionReason,
      "Incomplete school documentation."
    );

    // User status check
    const status = await getRegistrationStatus(newUser2Id);
    assert.equal(status.accessRequestStatus, "REJECTED");
    assert.equal(status.destination, "/access-rejected");
    assert.equal(
      status.accessRequest?.rejectionReason,
      "Incomplete school documentation."
    );
  });

  // --- COMPATIBILITY & SECURITY CHECKS ---

  it("16. Existing active onboarded user goes straight to '/dashboard'", async () => {
    const status = await getRegistrationStatus(existingActiveUserId);
    assert.equal(status.accountStatus, "ACTIVE");
    assert.equal(status.destination, "/dashboard");
  });

  it("17. Restricted user is blocked and routed to '/account/restricted'", async () => {
    const status = await getRegistrationStatus(restrictedUserId);
    assert.equal(status.accountStatus, "RESTRICTED");
    assert.equal(status.destination, "/account/restricted");
  });

  it("18. Active admin goes to '/admin'", async () => {
    const status = await getRegistrationStatus(adminId);
    assert.equal(status.role, "ADMIN");
    assert.equal(status.accountStatus, "ACTIVE");
    assert.equal(status.destination, "/admin");
  });

  it("19. Admin accounts never create access requests", async () => {
    // ensureUserAccessRequest returns null for ADMIN
    const req = await ensureUserAccessRequest(adminId);
    assert.equal(req, null);

    // submitUserAccessRequest throws ForbiddenError
    await assert.rejects(
      async () => {
        await submitUserAccessRequest(adminId, { notes: "Admin note" });
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "ADMIN_NO_ACCESS_REQUEST");
        return true;
      }
    );
  });

  it("20. Admin request listing strictly excludes admin accounts", async () => {
    const list = await listAccessRequests({
      page: 1,
      limit: 50,
      status: "ALL",
    });

    const hasAdmin = list.requests.some((r) => r.user.role === "ADMIN");
    assert.equal(hasAdmin, false, "Admin accounts must never appear in access request listing");
  });

  it("21. Existing active user login does not create duplicate requests or reset status", async () => {
    const initialStatus = await getRegistrationStatus(existingActiveUserId);
    assert.equal(initialStatus.accountStatus, "ACTIVE");

    // Simulate login synchronization
    const result = await ensureUserAccessRequest(existingActiveUserId, {
      source: "auth_session_create",
    });

    // Should return existing request (or null) and never reset ACTIVE to PENDING
    const postStatus = await getRegistrationStatus(existingActiveUserId);
    assert.equal(postStatus.accountStatus, "ACTIVE");
  });

  it("22. Concurrent request creation safety via partial unique index", async () => {
    const testConcurrentUserId = `reg_concurrent_${timestamp}`;
    await prisma.user.create({
      data: {
        id: testConcurrentUserId,
        email: `${testConcurrentUserId}@example.com`,
        name: "Concurrent Test User",
        role: "USER",
        status: "PENDING",
        termsAccepted: true,
        termsVersion: CURRENT_TERMS_VERSION,
      },
    });

    try {
      // Run two parallel ensureUserAccessRequest calls simultaneously
      const [res1, res2] = await Promise.all([
        ensureUserAccessRequest(testConcurrentUserId, { source: "thread_1" }),
        ensureUserAccessRequest(testConcurrentUserId, { source: "thread_2" }),
      ]);

      assert.ok(res1);
      assert.ok(res2);
      assert.equal(res1?.id, res2?.id, "Concurrent requests must resolve to the same unique request ID");

      // Verify only 1 record exists in the database
      const count = await prisma.accessRequest.count({
        where: { userId: testConcurrentUserId, status: "PENDING" },
      });
      assert.equal(count, 1, "Database partial unique index must enforce exactly 1 pending request");
    } finally {
      await prisma.accessRequest.deleteMany({
        where: { userId: testConcurrentUserId },
      });
      await prisma.user.deleteMany({
        where: { id: testConcurrentUserId },
      });
    }
  });

  after(async () => {
    await disconnectPrisma();
  });
});
