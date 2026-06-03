import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const checks: Record<string, string> = {};

  // Check env vars (names only, not values)
  checks.DATABASE_URL = process.env.DATABASE_URL ? "SET" : "MISSING";
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
  checks.VERCEL_URL = process.env.VERCEL_URL
    ? `SET (${process.env.VERCEL_URL})`
    : "MISSING";

  // Check DB connection
  try {
    const count = await prisma.user.count();
    checks.DB_CONNECTION = `OK (${count} users)`;
  } catch (err: unknown) {
    checks.DB_CONNECTION = `FAILED: ${err instanceof Error ? err.message : String(err)}`;
  }

  return NextResponse.json(checks);
}
