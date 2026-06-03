import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const collections = await prisma.collection.findMany({
    where: { userId: session.user.id },
    include: {
      sources: {
        select: { id: true, title: true },
        orderBy: { createdAt: "desc" },
        take: 2,
      },
      _count: { select: { sources: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(collections);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { name, description } = body;

  if (!name || typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  const collection = await prisma.collection.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      userId: session.user.id,
    },
    include: {
      sources: {
        select: { id: true, title: true },
        take: 2,
      },
      _count: { select: { sources: true } },
    },
  });

  return NextResponse.json(collection, { status: 201 });
}
