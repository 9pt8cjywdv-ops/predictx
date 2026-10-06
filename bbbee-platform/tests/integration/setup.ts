import { inject } from "vitest";

// Must run before any module constructs the Prisma client.
process.env.DATABASE_URL = inject("dbUrl");
