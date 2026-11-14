import { prisma } from "../src/lib/prisma.js";

async function main() {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      image: true,
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Total users in DB: ${users.length}`);
  let withImage = 0;
  let withoutImage = 0;
  for (const u of users) {
    if (u.image) {
      withImage++;
      try {
        const res = await fetch(u.image, { method: "HEAD" });
        console.log(`[HAS IMAGE - HTTP ${res.status}] ${u.role} | ${u.status} | ${u.email} | ${u.image}`);
      } catch (err: any) {
        console.log(`[HAS IMAGE - FETCH ERROR: ${err.message}] ${u.role} | ${u.status} | ${u.email} | ${u.image}`);
      }
    } else {
      withoutImage++;
      console.log(`[NO IMAGE]  ${u.role} | ${u.status} | ${u.email}`);
    }
  }
  console.log(`Summary: With Image: ${withImage}, Without Image: ${withoutImage}`);
}

main()
  .catch((err) => {
    console.error("Error inspecting users:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
