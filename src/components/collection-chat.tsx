"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface AgentCitation {
  sourceId: string;
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
}

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  citations?: AgentCitation[];
}

export interface ToolCallDisplay {
  kind: "search" | "read" | "list" | "inspect" | "compose" | "other";
  label: string;
  terms?: string[];
  target?: string;
  lineRange?: string;
  raw: string;
}

export interface ToolCall {
  id: string;
  name: "bash" | "read_file" | "done";
  args: Record<string, unknown>;
  display?: ToolCallDisplay;
}

export interface ToolResult {
  toolCallId: string;
  result: string;
  summary?: string;
}

interface CollectionChatProps {
  collectionId: string;
  sourceIds: string[];
  totalSourceCount: number;
  /** sourceId -> human title, used to label citation chips. */
  sourceTitles?: Record<string, string>;
  onCitationClick?: (citation: AgentCitation) => void;
  onCollapse?: () => void;
}

export default function CollectionChat({
  collectionId,
  sourceIds,
  totalSourceCount,
  sourceTitles,
  onCitationClick,
  onCollapse,
}: CollectionChatProps) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const hasConversation = messages.length > 0;
  const canSend = sourceIds.length > 0 && !isStreaming;

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

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming || !canSend) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: trimmed },
      { role: "assistant", content: "", streaming: true },
    ]);
    setInput("");
    setIsStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`/api/collections/${collectionId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          sourceIds,
          history: messages,
        }),
        signal: abort.signal,
      });

      if (!res.ok || !res.body) {
        const errMsg = await safeReadError(res);
        setMessages((prev) =>
          prev.map((m) =>
            m.role === "assistant" && m.content === ""
              ? { ...m, content: errMsg }
              : m
          )
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let assistantText = "";
      let finalCitations: AgentCitation[] = [];

      const applyEvent = (event: string, dataRaw: string) => {
        let data: unknown;
        try {
          data = JSON.parse(dataRaw);
        } catch {
          return;
        }
        if (event === "token") {
          assistantText += data as string;
          setMessages((prev) =>
            prev.map((m) =>
              m.role === "assistant" && m.content === ""
                ? { ...m, content: assistantText }
                : m
            )
          );
        } else if (event === "tool_call") {
          setMessages((prev) =>
            prev.map((m) =>
              m.role === "assistant"
                ? { ...m, toolCalls: [...(m.toolCalls || []), data as ToolCall] }
                : m
            )
          );
        } else if (event === "tool_result") {
          setMessages((prev) =>
            prev.map((m) =>
              m.role === "assistant"
                ? { ...m, toolResults: [...(m.toolResults || []), data as ToolResult] }
                : m
            )
          );
        } else if (event === "done") {
          const d = data as { answer?: string; citations: AgentCitation[] };
          finalCitations = d.citations;
          // Replace the noisy intermediate token stream with the clean
          // markdown answer that the agent produced via the `done` tool.
          const cleanAnswer = d.answer ?? assistantText;
          setMessages((prev) =>
            prev.map((m) =>
              m.role === "assistant"
                ? { ...m, content: cleanAnswer, citations: finalCitations, streaming: false }
                : m
            )
          );
        } else if (event === "error") {
          const d = data as { message: string };
          setMessages((prev) =>
            prev.map((m) =>
              m.role === "assistant" && m.content === ""
                ? { ...m, content: `Error: ${d.message}`, streaming: false }
                : m
            )
          );
        }
      };

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
        setMessages((prev) =>
          prev.map((m) =>
            m.role === "assistant" && m.content === ""
              ? { ...m, content: "_Stopped._", streaming: false }
              : m
          )
        );
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.role === "assistant" && m.content === ""
            ? { ...m, content: "Sorry — something went wrong.", streaming: false }
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-white">
      {/* Chat header — hidden on mobile to save space */}
      <div className="hidden h-[68px] shrink-0 items-center justify-between gap-2.5 border-b border-[#E5E7EB] px-[18px] py-3.5 lg:flex">
        <div className="flex items-center gap-2.5">
          <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[6px] bg-brand">
            <SparkleIcon size={16} />
          </div>
          <div>
            <div className="text-[14px] font-semibold leading-[19.6px] text-[#111827]">
              Ask this collection
            </div>
            <div className="text-[12px] leading-[16.8px] text-[#6B7280]">
              Answers grounded in {sourceIds.length} of {totalSourceCount} source
              {totalSourceCount !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
        {onCollapse && (
          <button
            onClick={onCollapse}
            className="flex h-[28px] w-[92px] items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-sm text-[#6B7280] transition-colors hover:bg-[#F3F4F6]"
          >
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M18 15l-6-6-6 6" />
            </svg>
            Collapse
          </button>
        )}
      </div>

      {/* Thread */}
      <div ref={threadRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 px-3 py-4 sm:px-5 sm:py-6">
          {!hasConversation ? (
            <EmptyState canSend={canSend} onPick={(p) => sendMessage(p)} />
          ) : (
            messages.map((m, i) => {
              if (m.role === "user") {
                return <UserBubble key={i} content={m.content} />;
              }
              return (
                <AssistantBubble
                  key={i}
                  message={m}
                  sourceTitles={sourceTitles}
                  onCitationClick={onCitationClick}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="shrink-0 flex flex-col gap-2 border-t border-[#E5E7EB] bg-white px-4 pt-3.5 pb-4">
        {/* Selection chip */}
        {sourceIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-[#B6E2E8] bg-[#E6F4F6] px-2 py-0.5">
              <svg width={10} height={10} viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
              </svg>
              <span className="text-xs font-medium text-[#374151]">
                {sourceIds.length === totalSourceCount
                  ? `All ${totalSourceCount} sources`
                  : `${sourceIds.length} of ${totalSourceCount} sources`}
              </span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 rounded-2xl border border-[#D1D5DB] bg-white px-3.5 py-2 pr-2 focus-within:border-brand">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              canSend
                ? "Ask a question across this collection…"
                : sourceIds.length === 0
                  ? "Select sources to ask about…"
                  : "Loading…"
            }
            disabled={!canSend}
            className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[13px] leading-[18.2px] text-[#111827] outline-none placeholder:text-[#9CA3AF] disabled:cursor-not-allowed"
          />
          {isStreaming ? (
            <button
              onClick={handleStop}
              aria-label="Stop generating"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#374151] text-white transition-colors hover:bg-[#1F2937]"
            >
              <StopIcon />
            </button>
          ) : (
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || !canSend}
              aria-label="Send message"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              <SendIcon />
            </button>
          )}
        </div>

      </div>
    </div>
  );
}

function EmptyState({
  canSend,
  onPick,
}: {
  canSend: boolean;
  onPick: (prompt: string) => void;
}) {
  const SUGGESTED_PROMPTS = [
    "Summarize the main argument across all sources",
    "Compare how each source defines a key concept",
    "What disagreements exist between the sources",
    "Build a study guide from the lecture and the papers",
  ];

  return (
    <div className="flex flex-col gap-5 px-5 py-6">
      <div className="flex flex-col gap-1.5">
        <p className="text-[18px] font-semibold leading-[23.4px] text-[#111827]">
          Ask anything across this collection
        </p>
        <p className="text-[13px] leading-[19.5px] text-[#6B7280]">
          Answers will cite the specific sources they came from. Uncheck sources to narrow the scope.
        </p>
      </div>
      {canSend && (
        <div className="w-full">
          <p className="mb-2 text-[11px] uppercase tracking-wider font-semibold text-[#6B7280]">Try asking</p>
          <div className="flex flex-col gap-2">
            {SUGGESTED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => onPick(prompt)}
                className="flex items-start gap-2.5 rounded-[10px] border border-[#E5E7EB] bg-white px-[14px] py-3 text-left text-sm text-[#374151] transition-colors hover:border-brand hover:bg-[#E7F1F2] hover:text-brand-dark"
              >
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-full sm:max-w-[70%] rounded-[14px] rounded-br-[4px] bg-brand px-4 py-2.5 text-sm leading-5 text-white">
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({
  message,
  sourceTitles,
  onCitationClick,
}: {
  message: AgentMessage;
  sourceTitles?: Record<string, string>;
  onCitationClick?: (citation: AgentCitation) => void;
}) {
  return (
    <div className="flex max-w-full sm:max-w-[85%] gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#E7F1F2]">
        <SparkleIcon size={13} color="#147885" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="rounded-[14px] rounded-tl-[4px] bg-[#F3F4F6] px-4 py-3 text-sm text-[#374151]">
          {/* Only render the answer once the agent is done. The intermediate
              token stream is the agent's scratch reasoning, not the answer, so
              we never show it — the final markdown arrives via the done event. */}
          {!message.streaming && message.content && (
            <div className="prose prose-sm max-w-none prose-p:my-3 prose-p:leading-6 prose-ul:my-3 prose-ol:my-3 prose-li:my-1 prose-li:leading-6 prose-headings:my-3 prose-pre:my-3 first:prose-p:mt-0 last:prose-p:mb-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content}
              </ReactMarkdown>
            </div>
          )}
          {/* Before the first tool call lands, show a thinking indicator so
              there's never a blank loading state. */}
          {message.streaming &&
            (!message.toolCalls || message.toolCalls.length === 0) && (
              <div className="inline-flex items-center gap-2 text-xs text-[#147885]">
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#147885]" />
                Thinking…
              </div>
            )}
          {/* Live activity feed: show each tool call + its inputs as the agent
              explores, then collapse behind a toggle once the answer lands. */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <AgentActivity
              toolCalls={message.toolCalls}
              toolResults={message.toolResults ?? []}
              live={!!message.streaming && !message.citations}
            />
          )}
        </div>
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.citations.map((c, i) => {
              const title = sourceTitles?.[c.sourceId];
              return (
                <button
                  key={i}
                  onClick={() => onCitationClick?.(c)}
                  title={
                    title
                      ? `${title} · lines ${c.lineStart}\u2013${c.lineEnd}`
                      : undefined
                  }
                  className="flex max-w-[240px] items-center gap-1 rounded-full border border-[#E5E7EB] bg-white px-3 py-1 text-xs font-medium text-[#374151] transition-colors hover:border-brand hover:bg-[#E7F1F2] hover:text-brand"
                >
                  <span className="truncate">{title ?? `Source ${i + 1}`}</span>
                  <span className="shrink-0 text-[#9CA3AF]">
                    L{c.lineStart}–{c.lineEnd}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Human-readable label + detail for a single tool call. Prefers the enriched
 * `display` built server-side (humanized titles, grep terms); falls back to a
 * best-effort parse of the raw args for older messages.
 */
function describeToolCall(tc: ToolCall): {
  label: string;
  terms?: string[];
  target?: string;
  raw: string;
} {
  if (tc.display) {
    const d = tc.display;
    return {
      label: d.label,
      terms: d.terms,
      target: d.lineRange ? `${d.target ?? ""} (lines ${d.lineRange})` : d.target,
      raw: d.raw,
    };
  }
  if (tc.name === "read_file") {
    const path = String(tc.args.path ?? "");
    return { label: "Read", target: path, raw: path };
  }
  if (tc.name === "done") {
    return { label: "Composing answer", raw: "done()" };
  }
  const command = String(tc.args.command ?? "");
  return { label: "Ran", raw: command };
}

/**
 * Real-time feed of the agent's tool calls. While `live`, the steps are shown
 * expanded with the in-flight one pulsing; once the answer arrives it collapses
 * into a toggle the user can expand to review what happened.
 */
function AgentActivity({
  toolCalls,
  toolResults,
  live,
}: {
  toolCalls: ToolCall[];
  toolResults: ToolResult[];
  live: boolean;
}) {
  const [open, setOpen] = useState(false);
  const resultById = new Map(toolResults.map((r) => [r.toolCallId, r]));

  const Steps = (
    <div className="flex flex-col gap-2">
      {toolCalls.map((tc, i) => {
        const { label, terms, target, raw } = describeToolCall(tc);
        const result = resultById.get(tc.id);
        const isLast = i === toolCalls.length - 1;
        const isDone = !live || !!result;
        const inFlight = live && isLast && !result;
        return (
          <div key={tc.id} className="flex items-start gap-2 text-xs">
            <span className="mt-[3px] flex h-3 w-3 shrink-0 items-center justify-center">
              {inFlight ? (
                <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[#147885]" />
              ) : isDone ? (
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="#147885" strokeWidth={3}>
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              ) : (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#9CA3AF]" />
              )}
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              {/* Humanized line: label + search terms / target */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="shrink-0 font-medium text-[#147885]">{label}</span>
                {terms?.map((t) => (
                  <span
                    key={t}
                    className="rounded bg-[#E7F1F2] px-1.5 py-0.5 font-medium text-[11px] text-[#147885]"
                  >
                    {t}
                  </span>
                ))}
                {target && (
                  <span className="min-w-0 truncate text-[#6B7280]">{target}</span>
                )}
              </div>
              {/* Raw command, kept for debugging */}
              <code
                title={raw}
                className="min-w-0 truncate rounded bg-[#F3F4F6] px-1.5 py-0.5 font-mono text-[10.5px] text-[#9CA3AF]"
              >
                {raw}
              </code>
              {/* One-line result summary once it lands */}
              {result?.summary && (
                <span className="text-[11px] text-[#6B7280]">{result.summary}</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );

  if (live) {
    return <div className="mt-2.5 border-l-2 border-[#B6E2E8] pl-2.5">{Steps}</div>;
  }

  return (
    <div className="mt-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-[#6B7280] transition-colors hover:text-[#147885]"
      >
        <svg
          width={12}
          height={12}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          className={`transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
        {toolCalls.length} step{toolCalls.length !== 1 ? "s" : ""}
      </button>
      {open && (
        <div className="mt-2 border-l-2 border-[#E5E7EB] pl-2.5">{Steps}</div>
      )}
    </div>
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

function StopIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="2" />
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

async function safeReadError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    // ignore
  }
  return `Request failed (${res.status})`;
}
