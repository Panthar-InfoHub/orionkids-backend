import { prisma } from "../src/lib/prisma.js";
import { logger } from "../src/lib/logger.js";

/**
 * Idempotent reconciliation script to audit and repair historical access requests.
 * Rules:
 * 1. PENDING regular users with 0 access requests -> create missing PENDING request.
 * 2. ADMIN accounts with open PENDING access requests -> close as APPROVED (reviewed by SYSTEM_RECONCILIATION).
 * 3. Never delete records. Never reset ACTIVE users to PENDING. Never modify existing rejection reasons.
 */
async function main() {
  console.log("=== STARTING ACCESS REQUEST RECONCILIATION ===");

  // 1. Repair ADMIN accounts that have obsolete PENDING access requests
  const adminPendingRequests = await prisma.accessRequest.findMany({
    where: {
      status: "PENDING",
      user: {
        role: "ADMIN",
      },
    },
    include: {
      user: {
        select: { id: true, email: true, name: true, role: true },
      },
    },
  });

  console.log(`Found ${adminPendingRequests.length} obsolete PENDING requests belonging to ADMIN accounts.`);
  for (const req of adminPendingRequests) {
    await prisma.accessRequest.update({
      where: { id: req.id },
      data: {
        status: "APPROVED",
        reviewedAt: new Date(),
        reviewedById: "SYSTEM_RECONCILIATION",
      },
    });
    console.log(`  -> Closed admin request ${req.id} for ${req.user.email} (${req.user.name})`);
  }

  // 2. Repair PENDING regular users who have NO access request in the database
  const pendingUsersWithoutRequests = await prisma.user.findMany({
    where: {
      role: "USER",
      status: "PENDING",
      accessRequests: {
        none: {},
      },
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
  });

  console.log(`Found ${pendingUsersWithoutRequests.length} PENDING users with NO access request.`);
  for (const user of pendingUsersWithoutRequests) {
    const created = await prisma.accessRequest.create({
      data: {
        userId: user.id,
        status: "PENDING",
        submittedAt: user.createdAt,
        notes: "Reconciled registration access request",
      },
    });
    console.log(`  -> Created missing access request ${created.id} for user ${user.email} (${user.id})`);
  }

  console.log("=== RECONCILIATION COMPLETE ===");
}

main()
  .catch((err) => {
    console.error("Reconciliation failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

