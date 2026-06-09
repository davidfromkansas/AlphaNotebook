/* eslint-disable no-console */
/** Smoke-test the full-context chat pipeline (Gemini). */
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { streamFullContextAnswer } from "../src/lib/chat";
import { describeLLM } from "../src/lib/llm";

async function ask(sourceId: string, question: string, label: string) {
  console.log(`\n=== ${label} ===`);
  console.log(`Q: ${question}`);

  const source = await prisma.source.findUnique({
    where: { id: sourceId },
    select: { id: true, title: true, author: true, content: true },
  });
  if (!source?.content) {
    console.error("missing content");
    return;
  }

  const chunks = (
    await prisma.sourceChunk.findMany({
      where: { sourceId },
      orderBy: { ord: "asc" },
      select: {
        id: true,
        ord: true,
        headingPath: true,
        charStart: true,
        charEnd: true,
      },
    })
  ).map((c) => ({
    id: c.id,
    ord: c.ord,
    headingPath: c.headingPath,
    charStart: c.charStart,
    charEnd: c.charEnd,
  }));

  console.log(
    `(${source.content.length.toLocaleString()} chars, ${chunks.length} chunk anchors)`
  );

  let text = "";
  let citations: { label: string; lineStart?: number; lineEnd?: number }[] = [];
  const t0 = Date.now();
  for await (const part of streamFullContextAnswer({
    question,
    sourceContent: source.content,
    sourceTitle: source.title,
    sourceAuthor: source.author,
    chunks,
    history: [],
  })) {
    if (part.type === "token") text += part.value;
    else if (part.type === "final") {
      text = part.value.text;
      citations = part.value.citations.map((c) => ({
        label: c.label,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
      }));
    }
  }
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`A (${dt}s):\n${text}`);
  console.log(`\ncitations: ${JSON.stringify(citations, null, 2)}`);
}

async function main() {
  console.log(`LLM: ${JSON.stringify(describeLLM())}`);

  const source = await prisma.source.findFirst({
    where: {
      status: "READY",
      title: { contains: "Frontier Lab", mode: "insensitive" },
    },
  });
  if (!source) {
    console.error("test source not found");
    process.exit(1);
  }
  console.log(`source: ${source.id} — ${source.title}`);

  await ask(source.id, "generate summary", "broad summary");
  await ask(
    source.id,
    "What does Vlad recommend studying first?",
    "narrow factual"
  );
  await ask(source.id, "What is the capital of France?", "off-topic (refusal)");

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
