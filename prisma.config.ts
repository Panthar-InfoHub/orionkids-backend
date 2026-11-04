import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // In test environment, target the isolated local test database.
    // In production/development, CLI commands use the direct connection.
    url:
      process.env.NODE_ENV === "test" && process.env.DATABASE_URL_TEST
        ? process.env.DATABASE_URL_TEST
        : (process.env.DIRECT_URL || process.env.DATABASE_URL)!,
  },
});
