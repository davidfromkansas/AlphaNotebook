import { prisma } from "./prisma";
import { chunkMarkdown } from "./chunking";

export interface IndexResult {
  chunkCount: number;
}

/**
 * Chunk a source's markdown into anchor records used for in-reader citation
 * scrolling. Full-context chat is the live retrieval path; the embedding +
 * vector index columns are left NULL (kept in schema for now in case we ever
 * re-enable hybrid retrieval).
 *
 * Idempotent: deletes existing chunks for the source first.
 */
export async function indexSource(sourceId: string): Promise<IndexResult> {
  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { id: true, content: true },
  });
  if (!source) throw new Error(`Source ${sourceId} not found`);
  if (!source.content || source.content.trim().length === 0) {
    throw new Error(`Source ${sourceId} has no content to index`);
  }

  await prisma.source.update({
    where: { id: sourceId },
    data: { indexStatus: "INDEXING" },
  });

  try {
    await prisma.sourceChunk.deleteMany({ where: { sourceId } });

    const chunks = chunkMarkdown(source.content);
    if (chunks.length === 0) {
      await prisma.source.update({
        where: { id: sourceId },
        data: { indexStatus: "READY" },
      });
      return { chunkCount: 0 };
    }

    // Plain insert — `embedding` stays NULL, `textSearch` is generated.
    await prisma.sourceChunk.createMany({
      data: chunks.map((c) => ({
        sourceId,
        ord: c.ord,
        headingPath: c.headingPath,
        text: c.text,
        charStart: c.charStart,
        charEnd: c.charEnd,
        tokenCount: Math.ceil(c.text.length / 4),
      })),
    });

    await prisma.source.update({
      where: { id: sourceId },
      data: { indexStatus: "READY" },
    });

    return { chunkCount: chunks.length };
  } catch (err) {
    await prisma.source.update({
      where: { id: sourceId },
      data: { indexStatus: "FAILED" },
    });
    throw err;
  }
}

