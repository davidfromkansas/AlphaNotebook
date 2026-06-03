import { PrismaClient } from "@/generated/prisma/client";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";

if (!globalThis.WebSocket) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  neonConfig.webSocketConstructor = require("ws");
}

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function getDatabaseUrl(): string {
  // Prefer unpooled URL for direct WebSocket connections (Neon + Vercel)
  const url =
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_URL_NON_POOLED ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("No database URL found in environment variables");
  }
  // Normalize postgres:// to postgresql:// for compatibility
  return url.replace(/^postgres:\/\//, "postgresql://");
}

function createPrismaClient() {
  const adapter = new PrismaNeon({
    connectionString: getDatabaseUrl(),
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
