import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import type { TestProject } from "vitest/node";

/**
 * Each run migrates a fresh, uniquely named schema in the dedicated test
 * database (never resets an existing one) and drops only that schema afterwards.
 */
export default async function setup(project: TestProject) {
  const base = process.env.TEST_DATABASE_URL ?? "postgresql://bbbee:bbbee@localhost:5432/bbbee_test";
  if (!/test/.test(new URL(base).pathname)) throw new Error("TEST_DATABASE_URL must point at a database whose name contains 'test'.");
  const schema = `it_${Date.now().toString(36)}_${process.pid}`;
  const url = new URL(base);
  url.searchParams.set("schema", schema);
  const dbUrl = url.toString();

  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: dbUrl } });
  rmSync("./storage-test", { recursive: true, force: true });
  project.provide("dbUrl", dbUrl);

  return async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await prisma.$disconnect();
    rmSync("./storage-test", { recursive: true, force: true });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    dbUrl: string;
  }
}
