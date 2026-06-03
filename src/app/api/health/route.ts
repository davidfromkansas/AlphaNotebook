import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const checks: Record<string, string> = {};

  // Check env vars (names only, not values — show protocol/host for URL debugging)
  const dbUrl = process.env.DATABASE_URL;
  const dbUrlUnpooled = process.env.DATABASE_URL_UNPOOLED;
  checks.DATABASE_URL = dbUrl
    ? `SET (starts with: ${dbUrl.substring(0, dbUrl.indexOf("://") + 3)}...)`
    : "MISSING";
  checks.DATABASE_URL_UNPOOLED = dbUrlUnpooled
    ? `SET (starts with: ${dbUrlUnpooled.substring(0, dbUrlUnpooled.indexOf("://") + 3)}...)`
    : "MISSING";
  checks.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ? "SET" : "MISSING";
  checks.GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
    ? "SET"
    : "MISSING";
  checks.AUTH_SECRET = process.env.AUTH_SECRET ? "SET" : "MISSING";
  checks.NEXTAUTH_SECRET = process.env.NEXTAUTH_SECRET ? "SET" : "MISSING";
  checks.NEXTAUTH_URL = process.env.NEXTAUTH_URL
    ? `SET (${process.env.NEXTAUTH_URL})`
    : "NOT SET (ok for Vercel)";
  checks.VERCEL = process.env.VERCEL ? "SET" : "MISSING";

  // Check DB connection
  try {
    const count = await prisma.user.count();
    checks.DB_CONNECTION = `OK (${count} users)`;
  } catch (err: unknown) {
    checks.DB_CONNECTION = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }

  return NextResponse.json(checks);
}
