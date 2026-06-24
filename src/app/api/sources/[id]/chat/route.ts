import { auth } from "@/lib/auth";
import { prisma, touchCollection } from "@/lib/prisma";
import {
  streamFullContextAnswer,
  REFUSAL_TEXT,
  isRefusal,
  type AssistantCitation,
  type PriorMessage,
  type ChunkAnchor,
} from "@/lib/chat";
import { describeLLM, type LLMUsage } from "@/lib/llm";

type StoredCitation = AssistantCitation;

interface ChatPostBody {
  message: string;
  conversationId?: string | null;
  /** When true, treat `message` as a re-ask: drop the most recent assistant
   *  turn (and the user turn that produced it) before generating. */
  regenerate?: boolean;
}

/** GET /api/sources/[id]/chat — return the most recent conversation + messages. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return jsonError("Unauthorized", 401);
  }
  const userId = session.user.id;
  const { id } = await params;

  const source = await prisma.source.findFirst({
    where: { id, collection: { userId } },
    select: { id: true, status: true },
  });
  if (!source) return jsonError("Not found", 404);

  const conversation = await prisma.conversation.findFirst({
    where: { sourceId: id, userId },
    orderBy: { updatedAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });

  // Chat works as soon as content has been extracted; the legacy chunk-index
  // status no longer gates anything.
  const chatReady = source.status === "READY";

  const messages = conversation?.messages.map((m) => ({
    id: m.id,
    role: m.role === "USER" ? "user" : "assistant",
    content: m.content,
    citations: (m.citations as unknown as StoredCitation[]) ?? [],
    createdAt: m.createdAt,
  })) ?? [];

  return Response.json({
    conversationId: conversation?.id ?? null,
    chatReady,
    /** Reason the source isn't chat-ready, when chatReady is false. */
    notReadyReason:
      chatReady ? null : source.status === "FAILED" ? "failed" : "pending",
    messages,
  });
}

/** POST /api/sources/[id]/chat — stream a grounded answer. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);
  const userId = session.user.id;
  const { id } = await params;

  let body: ChatPostBody;
  try {
    body = (await request.json()) as ChatPostBody;
  } catch {
    return jsonError("Invalid JSON", 400);
  }

  const question = (body.message ?? "").trim();
  if (!question) return jsonError("Empty message", 400);

  const source = await prisma.source.findFirst({
    where: { id, collection: { userId } },
    select: {
      id: true,
      collectionId: true,
      title: true,
      author: true,
      status: true,
      content: true,
    },
  });
  if (!source) return jsonError("Not found", 404);

  if (source.status !== "READY" || !source.content) {
    return jsonError(
      `Source isn't ready for chat yet (status=${source.status})`,
      409
    );
  }

  // Find or create conversation
  let conversation = body.conversationId
    ? await prisma.conversation.findFirst({
        where: { id: body.conversationId, sourceId: id, userId },
      })
    : null;
  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { sourceId: id, userId, title: source.title ?? null },
    });
  }
  const conversationId = conversation.id;

  // Regenerate: drop the most recent assistant turn AND the user turn that
  // produced it, so the new attempt replaces both — otherwise the LLM sees the
  // previous failed answer in its history and tends to repeat itself.
  if (body.regenerate) {
    const lastAssistant = await prisma.message.findFirst({
      where: { conversationId, role: "ASSISTANT" },
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true },
    });
    if (lastAssistant) {
      const priorUser = await prisma.message.findFirst({
        where: {
          conversationId,
          role: "USER",
          createdAt: { lt: lastAssistant.createdAt },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      const ids = [lastAssistant.id, ...(priorUser ? [priorUser.id] : [])];
      await prisma.message.deleteMany({ where: { id: { in: ids } } });
    }
  }

  // Load recent history (for the LLM)
  const priorRaw = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  const history: PriorMessage[] = priorRaw.map((m) => ({
    role: m.role === "USER" ? ("user" as const) : ("assistant" as const),
    content: m.content,
  }));

  // Persist user message immediately
  await prisma.message.create({
    data: { conversationId, role: "USER", content: question },
  });

  // Load chunk anchors (best-effort — used only to map line-range citations to
  // reader scroll positions and to render heading-path labels on chips).
  const chunkRows = await prisma.sourceChunk.findMany({
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
  const chunks: ChunkAnchor[] = chunkRows.map((c) => ({
    id: c.id,
    ord: c.ord,
    headingPath: c.headingPath,
    charStart: c.charStart,
    charEnd: c.charEnd,
  }));

  const encoder = new TextEncoder();
  const llmInfo = describeLLM();

  // Cancellation: when the client disconnects, abort the LLM call so we stop
  // racking up provider costs on an answer nobody will read.
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
      let assistantMessageId: string | null = null;
      let status: "completed" | "aborted" | "error" = "completed";
      let errorMessage: string | undefined;

      try {
        send("meta", {
          conversationId,
          provider: llmInfo.provider,
          model: llmInfo.model,
        });

        let finalText = "";
        let finalCitations: AssistantCitation[] = [];

        for await (const part of streamFullContextAnswer({
          question,
          sourceContent: source.content!,
          sourceTitle: source.title,
          sourceAuthor: source.author,
          chunks,
          history,
          signal: abortController.signal,
          onUsage: (u) => {
            usage = u;
          },
          onFirstToken: () => {
            ttftMs = Date.now() - startedAt;
          },
          onTruncated: (info) => {
            send("warning", {
              code: "truncated",
              message: `Document is ${info.originalChars.toLocaleString()} characters; truncated to the first ${info.truncatedTo.toLocaleString()} for this answer.`,
              ...info,
            });
          },
        })) {
          if (abortController.signal.aborted) {
            status = "aborted";
            break;
          }
          if (part.type === "token") {
            send("token", part.value);
          } else if (part.type === "final") {
            finalText = part.value.text;
            finalCitations = part.value.citations;
          }
        }

        if (status !== "aborted") {
          // Post-validation: trust the model when retrieval was confident.
          // Only normalize to a clean refusal if the model already produced one.
          if (isRefusal(finalText)) {
            finalText = REFUSAL_TEXT;
            finalCitations = [];
          }

          const saved = await prisma.message.create({
            data: {
              conversationId,
              role: "ASSISTANT",
              content: finalText,
              citations: finalCitations as unknown as object,
            },
          });
          assistantMessageId = saved.id;
          await prisma.conversation.update({
            where: { id: conversationId },
            data: { updatedAt: new Date() },
          });
          touchCollection(source.collectionId).catch(() => {});

          const latencyMs = Date.now() - startedAt;
          send("done", {
            citations: finalCitations,
            provider: llmInfo.provider,
            model: llmInfo.model,
            latencyMs,
            ttftMs,
            usage,
          });
        }
        controller.close();
      } catch (err) {
        // Distinguish abort from genuine errors.
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
          console.error("[chat] stream error:", err);
          send("error", { message: errorMessage });
        }
        controller.close();
      } finally {
        // Telemetry: best-effort, never throw.
        try {
          await prisma.llmCall.create({
            data: {
              userId,
              sourceId: id,
              conversationId,
              messageId: assistantMessageId,
              provider: usage?.provider ?? llmInfo.provider,
              model: usage?.model ?? llmInfo.model,
              inputTokens: usage?.inputTokens ?? null,
              cachedInputTokens: usage?.cachedInputTokens ?? null,
              outputTokens: usage?.outputTokens ?? null,
              thinkingTokens: usage?.thinkingTokens ?? null,
              latencyMs: Date.now() - startedAt,
              ttftMs: ttftMs ?? null,
              status,
              errorMessage: errorMessage ?? null,
            },
          });
        } catch (telemetryErr) {
          console.error("[chat] telemetry write failed:", telemetryErr);
        }
      }
    },
    cancel() {
      // Client disconnected — propagate to the LLM call.
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

/** DELETE /api/sources/[id]/chat — wipe the current conversation. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) return jsonError("Unauthorized", 401);
  const userId = session.user.id;
  const { id } = await params;

  await prisma.conversation.deleteMany({
    where: { sourceId: id, userId },
  });

  return Response.json({ ok: true });
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
