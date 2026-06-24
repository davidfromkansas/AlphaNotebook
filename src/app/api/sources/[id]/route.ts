import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma, touchCollection } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const source = await prisma.source.findFirst({
    where: {
      id,
      collection: {
        userId: session.user.id,
      },
    },
    include: {
      collection: {
        select: { id: true, name: true },
      },
    },
  });

  if (!source) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Exclude pdfData from the response — served via /api/sources/[id]/pdf
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pdfData: _, ...sourceWithoutPdf } = source;
  return NextResponse.json(sourceWithoutPdf);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const { title } = body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json(
      { error: "Title is required" },
      { status: 400 }
    );
  }

  const source = await prisma.source.findFirst({
    where: {
      id,
      collection: { userId: session.user.id },
    },
  });

  if (!source) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const updated = await prisma.source.update({
    where: { id },
    data: { title: title.trim() },
  });

  touchCollection(source.collectionId).catch(() => {});

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pdfData: _, ...updatedWithoutPdf } = updated;
  return NextResponse.json(updatedWithoutPdf);
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const source = await prisma.source.findFirst({
    where: {
      id,
      collection: { userId: session.user.id },
    },
  });

  if (!source) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.source.delete({ where: { id } });

  touchCollection(source.collectionId).catch(() => {});

  return NextResponse.json({ success: true });
}
