import { prisma } from "../src/lib/prisma.js";

async function run() {
  const child = await prisma.childProfile.findUnique({
    where: { id: "cmw0k6jsf0000i79y4c8yy471" },
    include: {
      user: {
        include: {
          childProfiles: true,
        },
      },
      questSessions: {
        include: {
          warmUpSubmission: true,
          levelAttempts: true,
        },
      },
    },
  });
  console.log("CHILD_FOUND:", child ? child.id : "null");
  if (child) {
    console.log("CHILD_NAME:", child.childName);
    console.log("PARENT_ID:", child.userId);
    console.log("TOTAL_CHILDREN_FOR_PARENT:", child.user.childProfiles.length);
    console.log(
      "CHILDREN_IDS:",
      child.user.childProfiles.map((c) => ({ id: c.id, name: c.childName }))
    );
    console.log(
      "SESSIONS:",
      child.questSessions.map((s) => ({
        id: s.id,
        status: s.status,
        currentStage: s.currentStage,
        hasWarmUp: Boolean(s.warmUpSubmission),
        attemptsCount: s.levelAttempts.length,
      }))
    );
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

