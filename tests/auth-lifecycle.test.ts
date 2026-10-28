import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/lib/prisma.js';
import { getCurrentUserProfile } from '../src/services/me.service.js';
import { submitUserOnboarding } from '../src/services/onboarding.service.js';
import { listUsers, setUserStatus } from '../src/services/admin.service.js';
import { ForbiddenError } from '../src/utils/errors.js';

describe('Auth & Onboarding Lifecycle Rules', () => {
  const ts = Date.now();
  const testAdminId = 'test-admin-' + ts;
  const testUserId = 'test-user-' + ts;
  const testRestrictedId = 'test-restricted-' + ts;

  before(async () => {
    // Seed test users
    await prisma.user.createMany({
      data: [
        {
          id: testAdminId,
          email: 'admin-' + ts + '@test.com',
          name: 'Test Administrator',
          role: 'ADMIN',
          status: 'ACTIVE',
        },
        {
          id: testUserId,
          email: 'user-' + ts + '@test.com',
          name: 'Test New User',
          role: 'USER',
          status: 'PENDING',
        },
        {
          id: testRestrictedId,
          email: 'restricted-' + ts + '@test.com',
          name: 'Test Restricted User',
          role: 'USER',
          status: 'RESTRICTED',
          restrictedReason: 'Violation of community safety standards',
        },
      ],
    });
  });

  after(async () => {
    // Cleanup seeded data
    await prisma.childProfile.deleteMany({
      where: { userId: { in: [testAdminId, testUserId, testRestrictedId] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [testAdminId, testUserId, testRestrictedId] } },
    });
    await prisma.$disconnect();
  });

  test('New authenticated user has PENDING status and onboardingSubmittedAt === null', async () => {
    const profile = await getCurrentUserProfile(testUserId);
    assert.equal(profile.id, testUserId);
    assert.equal(profile.status, 'PENDING');
    assert.equal(profile.role, 'USER');
    assert.equal(profile.onboardingSubmittedAt, null);
    assert.equal(profile.childProfile, null);
  });

  test('RESTRICTED user profile returns restrictedReason', async () => {
    const profile = await getCurrentUserProfile(testRestrictedId);
    assert.equal(profile.status, 'RESTRICTED');
    assert.equal(profile.restrictedReason, 'Violation of community safety standards');
  });

  test('RESTRICTED user cannot submit onboarding', async () => {
    await assert.rejects(
      async () => {
        await submitUserOnboarding(testRestrictedId, {
          childName: 'Baby Mallory',
          age: 6,
          language: 'English',
          selectedClass: 'Classes 1',
          parentEmail: 'parent@test.com',
          parentMobile: '+91 9999999999',
          isGuardian: true,
        });
      },
      (err) => err instanceof ForbiddenError && err.code === 'ACCOUNT_RESTRICTED'
    );
  });

  test('Valid user submits onboarding: binds data to user and sets onboardingSubmittedAt', async () => {
    const result = await submitUserOnboarding(testUserId, {
      childName: 'Aarav Sharma',
      age: 7,
      language: 'English',
      school: 'Orion Elementary',
      selectedClass: 'Classes 1',
      studentId: 'STU-101',
      parentEmail: 'parent@sharma.com',
      parentMobile: '+91 9876543210',
      isGuardian: true,
    });

    assert.equal(result.user.id, testUserId);
    assert.ok(result.user.onboardingSubmittedAt instanceof Date);
    assert.equal(result.childProfile.childName, 'Aarav Sharma');
    assert.equal(result.childProfile.age, 7);
    assert.equal(result.childProfile.school, 'Orion Elementary');

    // Verify /api/me response includes onboardingSubmittedAt
    const updatedProfile = await getCurrentUserProfile(testUserId);
    assert.ok(updatedProfile.onboardingSubmittedAt);
    assert.equal(updatedProfile.childProfile?.childName, 'Aarav Sharma');
  });

  test('Admin approval queue lists submitted onboarding requests awaiting review', async () => {
    const listResult = await listUsers({ page: 1, limit: 10, status: 'PENDING' });
    const foundUser = listResult.users.find((u) => u.id === testUserId);
    assert.ok(foundUser, 'User with submitted onboarding must be in the PENDING approval queue');
    assert.ok(foundUser.onboardingSubmittedAt, 'User in approval queue must have onboardingSubmittedAt');
  });

  test('Admin cannot modify their own account status', async () => {
    await assert.rejects(
      async () => {
        await setUserStatus(testAdminId, testAdminId, { status: 'RESTRICTED', reason: 'Self restrict' });
      },
      (err) => err instanceof ForbiddenError
    );
  });

  test('Admin approves submitted user: status changes to ACTIVE and reviewed metadata set', async () => {
    const approved = await setUserStatus(testAdminId, testUserId, { status: 'ACTIVE' });
    assert.equal(approved.id, testUserId);
    assert.equal(approved.status, 'ACTIVE');
    assert.equal(approved.reviewedById, testAdminId);
    assert.ok(approved.reviewedAt);

    // Profile check
    const profile = await getCurrentUserProfile(testUserId);
    assert.equal(profile.status, 'ACTIVE');
  });

  test('Admin restricts user: status changes to RESTRICTED and reason is stored', async () => {
    const restricted = await setUserStatus(testAdminId, testUserId, {
      status: 'RESTRICTED',
      reason: 'Inappropriate guardian verification',
    });
    assert.equal(restricted.id, testUserId);
    assert.equal(restricted.status, 'RESTRICTED');
    assert.equal(restricted.restrictedReason, 'Inappropriate guardian verification');

    const profile = await getCurrentUserProfile(testUserId);
    assert.equal(profile.status, 'RESTRICTED');
    assert.equal(profile.restrictedReason, 'Inappropriate guardian verification');
  });
});
