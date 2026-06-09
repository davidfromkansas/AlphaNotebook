import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { extractContent, parsePdfBuffer } from "@/lib/exa";
import { indexSource } from "@/lib/indexing";

const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    return handlePdfUpload(request, session.user.id);
  }

  return handleUrlSource(request, session.user.id);
}

async function handleUrlSource(request: Request, userId: string) {
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
    where: { id: collectionId, userId },
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
      sourceType: "URL",
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
      // Index for chat. Don't await — let it run in the background.
      indexSource(source.id).catch((err) => {
        console.error(`[indexSource] failed for ${source.id}:`, err);
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

async function handlePdfUpload(request: Request, userId: string) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data" },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  const collectionId = formData.get("collectionId");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "PDF file is required" },
      { status: 400 }
    );
  }

  if (!collectionId || typeof collectionId !== "string") {
    return NextResponse.json(
      { error: "Collection ID is required" },
      { status: 400 }
    );
  }

  if (!file.name.toLowerCase().endsWith(".pdf")) {
    return NextResponse.json(
      { error: "Only PDF files are supported" },
      { status: 400 }
    );
  }

  if (file.size > MAX_PDF_SIZE) {
    return NextResponse.json(
      { error: "File size exceeds 10 MB limit" },
      { status: 400 }
    );
  }

  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, userId },
  });

  if (!collection) {
    return NextResponse.json(
      { error: "Collection not found" },
      { status: 404 }
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  let extractedText: string | null = null;
  try {
    extractedText = parsePdfBuffer(buffer);
  } catch {
    // extraction failed — still save the PDF but mark as failed
  }

  const title = file.name.replace(/\.pdf$/i, "");

  const source = await prisma.source.create({
    data: {
      title,
      collectionId,
      sourceType: "PDF",
      fileName: file.name,
      pdfData: buffer,
      content: extractedText,
      status: extractedText ? "READY" : "FAILED",
    },
  });

  if (extractedText) {
    indexSource(source.id).catch((err) => {
      console.error(`[indexSource] failed for ${source.id}:`, err);
    });
  }

  // Don't send pdfData back to the client
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pdfData: _, ...sourceWithoutPdf } = source;
  return NextResponse.json(sourceWithoutPdf, { status: 201 });
}
