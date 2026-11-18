import { describe, it } from "node:test";
import assert from "node:assert";
import { normalizeDatabaseConnectionString } from "../src/lib/prisma.js";
import { parse as parsePgConnectionString } from "pg-connection-string";

describe("OrionKids — PostgreSQL & Neon SSL Configuration & TLS Normalization Suite", () => {
  it("1. Normalizes Neon connection string with sslmode=require to sslmode=verify-full", () => {
    const raw =
      "postgresql://user:secret@ep-cool-lake-123456.us-east-2.aws.neon.tech/neondb?sslmode=require&connect_timeout=15";
    const res = normalizeDatabaseConnectionString(raw);

    assert.strictEqual(res.isNeon, true);
    assert.strictEqual(res.sslRequired, true);
    assert.ok(
      res.normalizedConnectionString.includes("sslmode=verify-full"),
      "Must normalize sslmode=require to sslmode=verify-full"
    );
    assert.ok(
      !res.normalizedConnectionString.includes("sslmode=require"),
      "Must not retain sslmode=require"
    );

    // Verify pg-connection-string parses cleanly
    const parsed = parsePgConnectionString(res.normalizedConnectionString);
    assert.strictEqual(parsed.sslmode, "verify-full");
    assert.deepStrictEqual(parsed.ssl, {});
  });

  it("2. Appends sslmode=verify-full to Neon connection strings missing sslmode", () => {
    const raw =
      "postgresql://user:secret@ep-cool-lake-123456.us-east-2.aws.neon.tech/neondb";
    const res = normalizeDatabaseConnectionString(raw);

    assert.strictEqual(res.isNeon, true);
    assert.strictEqual(res.sslRequired, true);
    assert.ok(res.normalizedConnectionString.includes("sslmode=verify-full"));

    const parsed = parsePgConnectionString(res.normalizedConnectionString);
    assert.strictEqual(parsed.sslmode, "verify-full");
    assert.deepStrictEqual(parsed.ssl, {});
  });

  it("3. Neon pooled connection (with pgbouncer/channel_binding) preserves parameters with verify-full", () => {
    const raw =
      "postgresql://user:secret@ep-cool-lake-123456-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=prefer";
    const res = normalizeDatabaseConnectionString(raw);

    assert.strictEqual(res.isNeon, true);
    assert.strictEqual(res.sslRequired, true);
    assert.ok(res.normalizedConnectionString.includes("sslmode=verify-full"));
    assert.ok(res.normalizedConnectionString.includes("channel_binding=prefer"));

    const parsed = parsePgConnectionString(res.normalizedConnectionString);
    assert.strictEqual(parsed.sslmode, "verify-full");
    assert.strictEqual((parsed as any).channel_binding, "prefer");
  });

  it("4. Local PostgreSQL (localhost / 127.0.0.1) does not enforce SSL", () => {
    const raw = "postgresql://postgres:postgres@localhost:5432/orionkids_test";
    const res = normalizeDatabaseConnectionString(raw);

    assert.strictEqual(res.isNeon, false);
    assert.strictEqual(res.sslRequired, false);
    assert.strictEqual(res.normalizedConnectionString, raw);

    const parsed = parsePgConnectionString(res.normalizedConnectionString);
    assert.strictEqual(parsed.ssl, undefined);
  });

  it("5. Explicit sslmode=disable on local connection is strictly respected", () => {
    const raw =
      "postgresql://dev:pass@127.0.0.1:5432/orionkids_test?sslmode=disable";
    const res = normalizeDatabaseConnectionString(raw);

    assert.strictEqual(res.isNeon, false);
    assert.strictEqual(res.sslRequired, false);
    assert.ok(res.normalizedConnectionString.includes("sslmode=disable"));

    const parsed = parsePgConnectionString(res.normalizedConnectionString);
    assert.strictEqual(parsed.ssl, false);
  });

  it("6. External non-Neon host with explicit sslmode=verify-full is preserved", () => {
    const raw = "postgresql://user:pass@db.example.com:5432/mydb?sslmode=verify-full";
    const res = normalizeDatabaseConnectionString(raw);

    assert.strictEqual(res.isNeon, false);
    assert.strictEqual(res.sslRequired, true);
    assert.ok(res.normalizedConnectionString.includes("sslmode=verify-full"));

    const parsed = parsePgConnectionString(res.normalizedConnectionString);
    assert.strictEqual(parsed.sslmode, "verify-full");
    assert.deepStrictEqual(parsed.ssl, {});
  });

  it("7. Fallback regex handles malformed or non-standard URLs safely", () => {
    const raw = "postgres://custom-uri-pattern/neon.tech?sslmode=require";
    const res = normalizeDatabaseConnectionString(raw);

    assert.strictEqual(res.isNeon, true);
    assert.strictEqual(res.sslRequired, true);
    assert.ok(res.normalizedConnectionString.includes("sslmode=verify-full"));
  });
});

