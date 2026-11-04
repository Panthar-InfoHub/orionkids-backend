import { prisma } from "../src/lib/prisma.js";
import { getResumeState } from "../src/services/quest.service.js";

async function run() {
  const userId = "IWnY35xM9vy2iaHrOX6KVRUAj6O0ypYD";
  const childProfileId = "cmw0k6jsf0000i79y4c8yy471";
  
  try {
    const state = await getResumeState(userId, childProfileId);
    console.log("RESUME_STATE:", JSON.stringify(state, null, 2));
  } catch (err: any) {
    console.error("RESUME_ERROR:", err.message, err.code, err);
  }
}

run()
  .catch(console.error)
  .finally(() => prisma.$disconnect());

