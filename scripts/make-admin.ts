import { prisma } from "../src/lib/prisma.js";

async function main() {
  const email = process.argv[2]?.trim().toLowerCase();

  if (!email) {
    console.error("❌ Error: Missing user email.");
    console.error("Usage: npm run admin:make -- <email>");
    process.exit(1);
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true, role: true, status: true },
  });

  if (!user) {
    console.error(`❌ Error: User with email "${email}" does not exist.`);
    process.exit(1);
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        role: "ADMIN",
        status: "ACTIVE",
        emailVerified: true,
        restrictedReason: null,
        reviewedAt: new Date(),
      },
    });

    // Invalidate any existing sessions
    await tx.session.deleteMany({
      where: { userId: user.id },
    });
  });

  console.log(
    `✅ Successfully promoted user "${email}" (ID: ${user.id}) to ADMIN with status ACTIVE.`
  );
  console.log("   Existing sessions have been invalidated.");
}

main()
  .catch((err) => {
    console.error("❌ Error promoting user to admin:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
