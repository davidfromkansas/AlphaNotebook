import { auth } from "@/lib/auth";
import { prisma, touchCollection } from "@/lib/prisma";
import { streamAgent, type AgentCitation, type AgentMessage } from "@/lib/agent";
import type { LLMUsage } from "@/lib/llm";
import type { SourceFile } from "@/lib/sandbox";

interface AskPostBody {
  message: string;
  sourceIds: string[];
  history?: AgentMessage[];
}

/** POST /api/collections/:id/ask — stream a multi-source agent answer. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }
  const userId = session.user.id;
  const { id } = await params;

  let body: AskPostBody;
  try {
    body = (await request.json()) as AskPostBody;
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const question = (body.message ?? "").trim();
  if (!question) return jsonError("Empty message", 400);

  const sourceIds = body.sourceIds ?? [];
  if (sourceIds.length === 0) {
    return jsonError("No sources selected", 400);
  }

  // Verify collection ownership
  const collection = await prisma.collection.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!collection) return jsonError("Not found", 404);

  // Load the user's ENTIRE workspace (all READY sources across all their
  // collections) so the persistent sandbox can mirror it.
  const sources = await prisma.source.findMany({
    where: {
      status: "READY",
      collection: { userId },
    },
    select: {
      id: true,
      collectionId: true,
      title: true,
      author: true,
      url: true,
      content: true,
    },
  });

  const allSources: SourceFile[] = sources.map((s) => ({
    sourceId: s.id,
    collectionId: s.collectionId,
    title: s.title ?? "Untitled",
    author: s.author,
    url: s.url,
    content: s.content ?? "",
  }));

  // The in-scope subset for this chat: selected ids that are READY and belong
  // to the active collection.
  const activeSourceIds = allSources
    .filter((s) => s.collectionId === id && sourceIds.includes(s.sourceId))
    .map((s) => s.sourceId);

  if (activeSourceIds.length === 0) {
    return jsonError("No ready sources found", 400);
  }

  const chatId = crypto.randomUUID();

  const encoder = new TextEncoder();
  const abortController = new AbortController();
  request.signal.addEventListener("abort", () => abortController.abort(), {
    once: true,
  });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // controller already closed (client disconnected) — ignore.
        }
      };

      const startedAt = Date.now();
      let ttftMs: number | undefined;
      let usage: LLMUsage | undefined;
      let status: "completed" | "aborted" | "error" = "completed";
      let errorMessage: string | undefined;

      try {
        send("meta", {
          provider: "gemini",
          model: "gemini-2.5-flash",
        });

        let finalText = "";
        let finalCitations: AgentCitation[] = [];
        let sawFinal = false;

        for await (const part of streamAgent({
          userId,
          collectionId: id,
          chatId,
          question,
          allSources,
          activeSourceIds,
          history: body.history ?? [],
          signal: abortController.signal,
          onUsage: (u) => {
            usage = u;
          },
        })) {
          if (abortController.signal.aborted) {
            status = "aborted";
            break;
          }
          if (part.type === "token") {
            if (ttftMs === undefined) ttftMs = Date.now() - startedAt;
            send("token", part.value);
          } else if (part.type === "tool_call") {
            send("tool_call", part.value);
          } else if (part.type === "tool_result") {
            send("tool_result", part.value);
          } else if (part.type === "final") {
            finalText = (part.value as { text: string; citations: AgentCitation[] }).text;
            finalCitations = (part.value as { text: string; citations: AgentCitation[] }).citations;
            sawFinal = true;
          }
        }

        if (status !== "aborted") {
          touchCollection(id).catch(() => {});
          const latencyMs = Date.now() - startedAt;
          send("done", {
            // Forward the agent's final markdown answer so the client can
            // replace the noisy intermediate token stream with the clean text.
            answer: sawFinal ? finalText : undefined,
            citations: finalCitations,
            provider: "gemini",
            model: "gemini-2.5-flash",
            latencyMs,
            ttftMs,
            usage,
          });
        }
        controller.close();
      } catch (err) {
        const e = err as Error & { name?: string };
        if (
          abortController.signal.aborted ||
          e?.name === "AbortError" ||
          /aborted/i.test(e?.message ?? "")
        ) {
          status = "aborted";
        } else {
          status = "error";
          errorMessage = e?.message ?? String(err);
          console.error("[collections/ask] stream error:", err);
          send("error", { message: errorMessage });
        }
        controller.close();
      }
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
