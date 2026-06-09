import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/** GET /api/sources/[id]/chunks — chunk spans for in-reader anchoring. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const source = await prisma.source.findFirst({
    where: { id, collection: { userId: session.user.id } },
    select: { id: true },
  });
  if (!source) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const chunks = await prisma.sourceChunk.findMany({
    where: { sourceId: id },
    orderBy: { ord: "asc" },
    select: {
      id: true,
      ord: true,
      headingPath: true,
      charStart: true,
      charEnd: true,
    },
  });

  return Response.json({ chunks });
}
