import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma.js";
import {
  getRegistrationStatus,
  acceptUserTerms,
  submitUserAccessRequest,
  getMyAccessRequests,
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

  it("1. New user registration status directs to '/terms-and-conditions'", async () => {
    const status = await getRegistrationStatus(newUser1Id);
    assert.equal(status.termsAccepted, false);
    assert.equal(status.accessRequestStatus, "NONE");
    assert.equal(status.destination, "/terms-and-conditions");
  });

  it("2. User cannot submit access request before accepting terms", async () => {
    await assert.rejects(
      async () => {
        await submitUserAccessRequest(newUser1Id, {});
      },
      (err: any) => {
        assert.ok(err instanceof ForbiddenError);
        assert.equal(err.code, "TERMS_REQUIRED");
        return true;
      }
    );
  });

  it("3. User accepts terms successfully and state updates to '/access-request'", async () => {
    const status = await acceptUserTerms(
      newUser1Id,
      { agree: true },
      { ipAddress: "127.0.0.1", userAgent: "NodeTestRunner" }
    );

    assert.equal(status.termsAccepted, true);
    assert.equal(status.currentTermsVersion, CURRENT_TERMS_VERSION);
    assert.equal(status.userTermsVersion, CURRENT_TERMS_VERSION);
    assert.ok(status.termsAcceptedAt);
    assert.equal(status.accessRequestStatus, "NONE");
    assert.equal(status.destination, "/access-request");

    // Verify audit record in terms_acceptance table
    const auditRecords = await prisma.termsAcceptance.findMany({
      where: { userId: newUser1Id },
    });
    assert.equal(auditRecords.length, 1);
    assert.equal(auditRecords[0]!.termsVersion, CURRENT_TERMS_VERSION);
    assert.equal(auditRecords[0]!.ipAddress, "127.0.0.1");
  });

  it("4. Refreshing after accepting terms does not ask to accept again", async () => {
    const status = await getRegistrationStatus(newUser1Id);
    assert.equal(status.termsAccepted, true);
    assert.equal(status.destination, "/access-request");
  });

  // --- STAGE 4 & 5: SUBMIT ACCESS REQUEST & PENDING SCREEN ---

  it("5. User submits an access request and state becomes '/access-pending'", async () => {
    const res = await submitUserAccessRequest(newUser1Id, {
      notes: "Requesting access for 2nd grade student.",
    });

    assert.ok(res.request);
    assert.ok(res.request!.id);
    assert.equal(res.request!.status, "PENDING");
    assert.equal(res.status.accessRequestStatus, "PENDING");
    assert.equal(res.status.accountStatus, "PENDING");
    assert.equal(res.status.destination, "/access-pending");

    request1Id = res.request!.id;
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
    await acceptUserTerms(newUser2Id, { agree: true });

    // User 2 submits request
    const sub = await submitUserAccessRequest(newUser2Id, {});
    assert.ok(sub.request);
    request2Id = sub.request!.id;

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

  it("17. Restricted user is blocked and routed to '/access-denied'", async () => {
    const status = await getRegistrationStatus(restrictedUserId);
    assert.equal(status.accountStatus, "RESTRICTED");
    assert.equal(status.destination, "/access-denied");
  });

  it("18. Active admin goes to '/admin'", async () => {
    const status = await getRegistrationStatus(adminId);
    assert.equal(status.role, "ADMIN");
    assert.equal(status.accountStatus, "ACTIVE");
    assert.equal(status.destination, "/admin");
  });
});
