"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Allow our internal `cite:N` href scheme through react-markdown's URL
 * sanitizer. Without this, react-markdown blanks the href, our `a` renderer
 * never sees the `cite:` prefix, and the link falls back to a plain `<a>`
 * with an empty href — clicking it reloads the page.
 */
const citationUrlTransform = (url: string): string => {
  if (url.startsWith("cite:")) return url;
  return defaultUrlTransform(url);
};

export interface Citation {
  label: string;
  /** Chunk id (used to scroll to that chunk in the reader pane). */
  anchor?: string;
  /** Chunk ord within the source — useful for sorting. */
  ord?: number;
  /** Heading path for the cited chunk. */
  headingPath?: string | null;
  /** Exact line range as cited by the model. */
  lineStart?: number;
  lineEnd?: number;
  /** Exact char range — used for line-precise scroll + highlight. */
  charStart?: number;
  charEnd?: number;
}

export interface AssistantMeta {
  provider: string;
  model: string;
  latencyMs?: number;
  ttftMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  thinkingTokens?: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  /** True while the assistant message is still streaming in. */
  streaming?: boolean;
  meta?: AssistantMeta;
  /** Truncation warning shown above the message bubble. */
  warning?: string;
}

interface SourceChatProps {
  sourceId: string;
  sourceTitle: string;
  /** Whether the source reader pane is collapsed (chat goes full width). */
  collapsed: boolean;
  /** Called when a citation chip is clicked, with the citation anchor. */
  onCitationClick?: (citation: Citation) => void;
  /** When provided, renders a dismiss (✕) button in the header (mobile sheet). */
  onClose?: () => void;
  /** Renders a persistent "Rooted in [source]" strip below the header (mobile). */
  rootedInStrip?: boolean;
}

interface ApiCitation {
  chunkId: string | null;
  ord: number | null;
  headingPath: string | null;
  label: string;
  lineStart?: number;
  lineEnd?: number;
  charStart?: number;
  charEnd?: number;
}

interface HistoryResponse {
  conversationId: string | null;
  chatReady: boolean;
  notReadyReason: "pending" | "failed" | null;
  messages: {
    id: string;
    role: "user" | "assistant";
    content: string;
    citations: ApiCitation[];
  }[];
}

type ChatReadiness = "loading" | "ready" | "pending" | "failed";

function toCitation(c: ApiCitation): Citation {
  return {
    label: c.label,
    anchor: c.chunkId ?? undefined,
    ord: c.ord ?? undefined,
    headingPath: c.headingPath,
    lineStart: c.lineStart,
    lineEnd: c.lineEnd,
    charStart: c.charStart,
    charEnd: c.charEnd,
  };
}

const SUGGESTED_PROMPTS = [
  "Summarize key claims",
  "Find cited examples",
  "Create study notes",
];

let idCounter = 0;
const nextId = () => `m-${Date.now()}-${idCounter++}`;

async function safeReadError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    // ignore
  }
  return `Request failed (${res.status})`;
}

export default function SourceChat({
  sourceId,
  sourceTitle,
  collapsed,
  onCitationClick,
  onClose,
  rootedInStrip,
}: SourceChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [readiness, setReadiness] = useState<ChatReadiness>("loading");
  const loadingHistory = readiness === "loading";
  const isReady = readiness === "ready";
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasConversation = messages.length > 0;

  // Load conversation history + index status on mount and when source changes.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/sources/${sourceId}/chat`)
      .then((r) => (r.ok ? (r.json() as Promise<HistoryResponse>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setConversationId(data.conversationId);
        setReadiness(
          data.chatReady
            ? "ready"
            : data.notReadyReason === "failed"
              ? "failed"
              : "pending"
        );
        setMessages(
          data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            citations: (m.citations || []).map(toCitation),
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setReadiness("failed");
      });
    return () => {
      cancelled = true;
      abortRef.current?.abort();
    };
  }, [sourceId]);

  // Auto-scroll the thread to the bottom as messages stream in.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Auto-grow the composer textarea.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [input]);

  const sendMessage = async (
    text: string,
    opts?: { regenerate?: boolean; replaceLastAssistantId?: string }
  ) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;
    if (!isReady) return;

    const assistantId = nextId();
    setMessages((prev) => {
      // For regenerate: drop the last assistant turn (and the user turn that
      // produced it), then re-append a fresh user + streaming assistant pair.
      let next = prev;
      if (opts?.replaceLastAssistantId) {
        const idx = next.findIndex(
          (m) => m.id === opts.replaceLastAssistantId
        );
        if (idx !== -1) {
          // Drop the assistant and the immediately preceding user turn.
          const cut = idx > 0 && next[idx - 1].role === "user" ? idx - 1 : idx;
          next = next.slice(0, cut);
        }
      }
      return [
        ...next,
        { id: nextId(), role: "user", content: trimmed },
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ];
    });
    setInput("");
    setIsStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`/api/sources/${sourceId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          conversationId,
          regenerate: !!opts?.regenerate,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const errMsg = await safeReadError(res);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content: errMsg,
                  streaming: false,
                }
              : m
          )
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistantText = "";
      let finalCitations: Citation[] = [];

      const applyEvent = (event: string, dataRaw: string) => {
        let data: unknown;
        try {
          data = JSON.parse(dataRaw);
        } catch {
          return;
        }
        if (event === "meta") {
          const d = data as {
            conversationId: string;
            provider?: string;
            model?: string;
          };
          if (d.conversationId) setConversationId(d.conversationId);
          if (d.provider && d.model) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId
                  ? {
                      ...m,
                      meta: { provider: d.provider!, model: d.model! },
                    }
                  : m
              )
            );
          }
        } else if (event === "warning") {
          const d = data as { message: string };
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, warning: d.message } : m
            )
          );
        } else if (event === "token") {
          assistantText += data as string;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: assistantText, streaming: true }
                : m
            )
          );
        } else if (event === "replace") {
          const d = data as { text: string };
          assistantText = d.text;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? { ...m, content: assistantText, streaming: true }
                : m
            )
          );
        } else if (event === "done") {
          const d = data as {
            citations: ApiCitation[];
            provider?: string;
            model?: string;
            latencyMs?: number;
            ttftMs?: number;
            usage?: {
              inputTokens?: number;
              outputTokens?: number;
              cachedInputTokens?: number;
              thinkingTokens?: number;
            };
          };
          finalCitations = (d.citations || []).map(toCitation);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: assistantText,
                    citations: finalCitations,
                    streaming: false,
                    meta:
                      d.provider && d.model
                        ? {
                            provider: d.provider,
                            model: d.model,
                            latencyMs: d.latencyMs,
                            ttftMs: d.ttftMs,
                            inputTokens: d.usage?.inputTokens,
                            outputTokens: d.usage?.outputTokens,
                            cachedInputTokens: d.usage?.cachedInputTokens,
                            thinkingTokens: d.usage?.thinkingTokens,
                          }
                        : m.meta,
                  }
                : m
            )
          );
        } else if (event === "error") {
          const d = data as { message: string };
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    content: assistantText || `Error: ${d.message}`,
                    streaming: false,
                  }
                : m
            )
          );
        }
      };

      // Parse SSE stream.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          let event = "message";
          const dataLines: string[] = [];
          for (const line of raw.split("\n")) {
            if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (dataLines.length > 0) applyEvent(event, dataLines.join("\n"));
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        // User stopped the stream — keep whatever text streamed so far and
        // mark the message as no-longer-streaming.
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  streaming: false,
                  content: m.content || "_Stopped._",
                }
              : m
          )
        );
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: "Sorry — something went wrong.",
                streaming: false,
              }
            : m
        )
      );
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleRegenerate = () => {
    if (isStreaming) return;
    // Find the last user message that produced the most recent assistant turn.
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx <= 0) return;
    const lastAssistant = messages[lastAssistantIdx];
    const priorUser = messages[lastAssistantIdx - 1];
    if (!priorUser || priorUser.role !== "user") return;
    sendMessage(priorUser.content, {
      regenerate: true,
      replaceLastAssistantId: lastAssistant.id,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleNewChat = async () => {
    if (isStreaming) return;
    setMessages([]);
    setInput("");
    setConversationId(null);
    try {
      await fetch(`/api/sources/${sourceId}/chat`, { method: "DELETE" });
    } catch {
      // Non-fatal: server keeps history but UI starts fresh.
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-white">
      {/* Chat header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E5E7EB] px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[9px] bg-brand">
            <SparkleIcon />
          </div>
          <div>
            <div className="text-sm font-semibold text-[#111827]">
              Ask this source
            </div>
            <div className="text-xs text-[#6B7280]">
              Answers grounded in this document
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {collapsed && (
            <div className="flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-[#F7F8FA] px-3 py-1.5">
              <DocIcon className="text-[#147885]" />
              <span className="text-xs text-[#6B7280]">Rooted in</span>
              <span className="max-w-[220px] truncate text-xs font-semibold text-[#111827]">
                {sourceTitle}
              </span>
            </div>
          )}
          <button
            onClick={handleNewChat}
            disabled={isStreaming || !hasConversation}
            className="flex items-center gap-1.5 rounded-md border border-[#E5E7EB] px-2.5 py-1.5 text-xs font-medium text-[#374151] transition-colors hover:bg-[#F7F8FA] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon />
            New chat
          </button>
          {onClose && (
            <button
              onClick={onClose}
              aria-label="Dismiss"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#E5E7EB] text-[#6B7280] transition-colors hover:bg-[#F7F8FA]"
            >
              <CloseIcon />
            </button>
          )}
        </div>
      </div>

      {/* Persistent grounding strip (mobile sheet) */}
      {rootedInStrip && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[#E5E7EB] bg-[#F7F8FA] px-4 py-2.5">
          <DocIcon className="text-[#147885]" />
          <span className="shrink-0 text-xs text-[#6B7280]">Rooted in</span>
          <span className="truncate text-xs font-semibold text-[#111827]">
            {sourceTitle}
          </span>
        </div>
      )}

      {/* Thread */}
      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
        <div
          className={`mx-auto flex flex-col gap-[18px] px-5 py-5 ${
            collapsed ? "max-w-[768px]" : ""
          }`}
        >
          {loadingHistory ? (
            <div className="py-6 text-sm text-[#6B7280]">Loading…</div>
          ) : !hasConversation ? (
            <EmptyState
              onPick={(p) => sendMessage(p)}
              readiness={readiness}
            />
          ) : (
            messages.map((m, i) => {
              if (m.role === "user") {
                return <UserBubble key={m.id} content={m.content} />;
              }
              const isLastAssistant =
                i === messages.length - 1 && !m.streaming;
              return (
                <AssistantBubble
                  key={m.id}
                  message={m}
                  onCitationClick={onCitationClick}
                  onRegenerate={
                    isLastAssistant && !isStreaming
                      ? handleRegenerate
                      : undefined
                  }
                />
              );
            })
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-[#E5E7EB] bg-white px-5 py-4">
        <div className={`mx-auto ${collapsed ? "max-w-[768px]" : ""}`}>
          <div className="flex items-end gap-2 rounded-2xl border border-[#D1D5DB] bg-white px-4 py-2.5 focus-within:border-brand">
            <textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                readiness === "ready"
                  ? "Ask a question about this source…"
                  : readiness === "pending"
                    ? "Preparing this source for chat…"
                    : readiness === "failed"
                      ? "This source failed to import. Try re-importing it."
                      : "Loading…"
              }
              disabled={!isReady}
              className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm text-[#111827] outline-none placeholder:text-[#9CA3AF] disabled:cursor-not-allowed"
            />
            {isStreaming ? (
              <button
                onClick={handleStop}
                aria-label="Stop generating"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#374151] text-white transition-colors hover:bg-[#1F2937]"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || !isReady}
                aria-label="Send message"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
              >
                <SendIcon />
              </button>
            )}
          </div>
          <p className="mt-2 text-center text-[11px] text-[#9CA3AF]">
            Answers are grounded in this source and may be incomplete. Verify
            important details.
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  onPick,
  readiness,
}: {
  onPick: (prompt: string) => void;
  readiness: ChatReadiness;
}) {
  const ready = readiness === "ready";
  return (
    <div className="flex flex-col items-start gap-4 py-6">
      <p className="text-sm text-[#6B7280]">
        {ready
          ? "Ask anything about this source. Every answer is grounded in — and cites — this document."
          : readiness === "pending"
            ? "Preparing this source for chat… this usually takes a few seconds."
            : readiness === "failed"
              ? "We couldn’t prepare this source for chat. Try re-importing it."
              : "Loading…"}
      </p>
      {ready && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              onClick={() => onPick(prompt)}
              className="rounded-full border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#374151] transition-colors hover:border-brand hover:bg-[#E7F1F2] hover:text-brand-dark"
            >
              {prompt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[70%] rounded-[14px] rounded-br-[4px] bg-brand px-4 py-2.5 text-sm leading-5 text-white">
        {content}
      </div>
    </div>
  );
}

/**
 * Rewrite `[L42-L58]` / `[L42-L58, L100-L120]` markers in the assistant's
 * prose into markdown links (`[L42-L58](cite:0)`) that the renderer turns
 * into clickable jumps. Returns the original text untouched when no citations
 * have been parsed yet (still streaming, or none matched).
 */
function linkifyCitations(text: string, citations: Citation[] | undefined): string {
  if (!citations || citations.length === 0) return text;

  // Build a tolerant lookup: by exact `start-end`, and (for fuzzy fallback)
  // by lineStart and lineEnd individually so that singleton tokens like `L963`
  // inside a `–` (en-dash) range can still resolve to the closest citation.
  const exact = new Map<string, number>();
  const byStart = new Map<number, number>();
  const byEnd = new Map<number, number>();
  citations.forEach((c, i) => {
    if (typeof c.lineStart !== "number") return;
    const le = c.lineEnd ?? c.lineStart;
    const ls = Math.min(c.lineStart, le);
    const lend = Math.max(c.lineStart, le);
    if (!exact.has(`${ls}-${lend}`)) exact.set(`${ls}-${lend}`, i);
    if (!byStart.has(ls)) byStart.set(ls, i);
    if (!byEnd.has(lend)) byEnd.set(lend, i);
  });
  if (exact.size === 0) return text;

  // Avoid mangling already-linkified content (idempotent).
  if (text.includes("](cite:")) return text;

  // Match `[ ... ]` blocks that look like line citations (contain at least
  // one digit run — covers `[L42-L58]`, `[42-58]`, `[Lines 42–58]`, etc.).
  const bracketRe = /\[([^\]\[]*\d+[^\]\[]*)\]/g;
  // Inside a bracket: capture `Lxx[–-]Lyy`, `Lxx[–-]yy`, or singleton `Lxx` /
  // `xx`. Accept ASCII hyphen, en-dash (–), em-dash (—), and minus-sign (−).
  const itemRe = /L?(\d+)(?:\s*[-–—−]\s*L?(\d+))?/gi;

  return text.replace(bracketRe, (whole, inner: string) => {
    let touched = false;
    const replaced = inner.replace(itemRe, (match, a: string, b?: string) => {
      const ls = parseInt(a, 10);
      const le = b ? parseInt(b, 10) : ls;
      if (Number.isNaN(ls)) return match;
      const lo = Math.min(ls, le);
      const hi = Math.max(ls, le);
      const key = `${lo}-${hi}`;
      const idx =
        exact.get(key) ?? byStart.get(lo) ?? byEnd.get(hi) ?? undefined;
      if (idx === undefined) return match;
      touched = true;
      const display = lo === hi ? `L${lo}` : `L${lo}-L${hi}`;
      return `[${display}](cite:${idx})`;
    });
    return touched ? `[${replaced}]` : whole;
  });
}

function AssistantBubble({
  message,
  onCitationClick,
  onRegenerate,
}: {
  message: ChatMessage;
  onCitationClick?: (citation: Citation) => void;
  onRegenerate?: () => void;
}) {
  return (
    <div className="flex max-w-[85%] gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#E7F1F2]">
        <SparkleIcon size={13} color="#147885" />
      </div>
      <div className="flex flex-col gap-2">
        {message.warning && (
          <div className="flex items-start gap-2 rounded-md border border-[#FEF3C7] bg-[#FFFBEB] px-3 py-2 text-xs text-[#92400E]">
            <WarningIcon />
            <span>{message.warning}</span>
          </div>
        )}
        <div className="rounded-[14px] rounded-tl-[4px] bg-[#F3F4F6] px-4 py-3 text-sm text-[#374151]">
          {message.content && (
            <div className="prose prose-sm max-w-none prose-p:my-3 prose-p:leading-6 prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-li:leading-6 prose-headings:my-3 prose-pre:my-3 first:prose-p:mt-0 last:prose-p:mb-0">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                urlTransform={citationUrlTransform}
                components={{
                  a: ({ children, href, ...props }) => {
                    // Inline citation link: rewrite [L42-L58] markers in the
                    // prose into clickable jumps that scroll the reader pane.
                    if (href?.startsWith("cite:")) {
                      const idx = parseInt(href.slice(5), 10);
                      const c = message.citations?.[idx];
                      return (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            if (c) onCitationClick?.(c);
                          }}
                          title={c?.headingPath ?? undefined}
                          className="mx-0.5 inline rounded text-brand underline decoration-dotted underline-offset-2 hover:bg-[#E7F1F2] hover:no-underline"
                        >
                          {children}
                        </button>
                      );
                    }
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand hover:underline"
                        {...props}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {linkifyCitations(message.content, message.citations)}
              </ReactMarkdown>
            </div>
          )}
          {message.streaming && <TypingCursor empty={!message.content} />}
        </div>
        {(message.meta || onRegenerate) && !message.streaming && (
          <div className="flex items-center gap-3 text-[11px] text-[#9CA3AF]">
            {message.meta && (
              <span>
                {message.meta.model}
                {typeof message.meta.latencyMs === "number" && (
                  <> · {(message.meta.latencyMs / 1000).toFixed(1)}s</>
                )}
                {typeof message.meta.outputTokens === "number" && (
                  <> · {message.meta.outputTokens} out</>
                )}
              </span>
            )}
            {onRegenerate && (
              <button
                onClick={onRegenerate}
                className="inline-flex items-center gap-1 rounded text-[#6B7280] hover:text-[#147885]"
              >
                <RefreshIcon /> Regenerate
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function WarningIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      className="mt-0.5 shrink-0"
    >
      <path
        d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 12a9 9 0 0 1 15.5-6.3L21 8M21 3v5h-5M21 12a9 9 0 0 1-15.5 6.3L3 16M3 21v-5h5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function TypingCursor({ empty }: { empty: boolean }) {
  if (empty) {
    return (
      <span className="inline-flex gap-1 py-0.5 align-middle">
        <Dot delay="0ms" />
        <Dot delay="150ms" />
        <Dot delay="300ms" />
      </span>
    );
  }
  return (
    <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-[#9CA3AF]" />
  );
}

function Dot({ delay }: { delay: string }) {
  return (
    <span
      className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#9CA3AF]"
      style={{ animationDelay: delay }}
    />
  );
}

function SparkleIcon({
  size = 18,
  color = "#FFFFFF",
}: {
  size?: number;
  color?: string;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z"
        fill={color}
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M6 6l12 12M18 6L6 18"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DocIcon({ className }: { className?: string }) {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
    >
      <path
        d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M14 3v5h5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
