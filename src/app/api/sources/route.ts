import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { extractContent } from "@/lib/exa";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { url, collectionId } = body;

  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "URL is required" }, { status: 400 });
  }

  if (!collectionId || typeof collectionId !== "string") {
    return NextResponse.json(
      { error: "Collection ID is required" },
      { status: 400 }
    );
  }

  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, userId: session.user.id },
  });

  if (!collection) {
    return NextResponse.json(
      { error: "Collection not found" },
      { status: 404 }
    );
  }

  const source = await prisma.source.create({
    data: {
      url,
      collectionId,
      status: "PENDING",
    },
  });

  extractContent(url)
    .then(async (content) => {
      await prisma.source.update({
        where: { id: source.id },
        data: {
          title: content.title,
          author: content.author,
          content: content.text,
          status: "READY",
        },
      });
    })
    .catch(async () => {
      await prisma.source.update({
        where: { id: source.id },
        data: { status: "FAILED" },
      });
    });

  return NextResponse.json(source, { status: 201 });
}
