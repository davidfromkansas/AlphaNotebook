import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  const source = await prisma.source.findFirst({
    where: {
      id,
      sourceType: "PDF",
      collection: {
        userId: session.user.id,
      },
    },
    select: {
      pdfData: true,
      fileName: true,
    },
  });

  if (!source?.pdfData) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(source.pdfData, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${source.fileName || "document.pdf"}"`,
    },
  });
}
