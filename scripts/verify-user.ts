import { prisma } from "../src/lib/prisma.js";

/**
 * Migration helper: marks an existing user's local email as verified.
 * This allows Better Auth's secure account linking to implicitly link
 * their incoming Google OAuth identity on first sign-in, while preserving
 * their existing user ID, role, status, and related data.
 */
async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error("❌ Error: Missing user email.");
    console.error("Usage: npm run user:verify -- <email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      status: true,
      emailVerified: true,
    },
  });

  if (!user) {
    console.error(`❌ Error: User with email "${email}" does not exist.`);
    process.exit(1);
  }

  if (user.emailVerified) {
    console.log(`ℹ️ User "${email}" is already marked as verified.`);
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { emailVerified: true },
  });

  console.log(
    `✅ Successfully verified email for user "${email}" (ID: ${user.id}).`
  );
  console.log(
    "   The user can now sign in with Google OAuth to link their existing account."
  );
}

main()
  .catch((err) => {
    console.error("❌ Error verifying user:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
