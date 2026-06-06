"use client";

import { useEffect, useRef, useState } from "react";

export interface Citation {
  label: string;
  /** Optional anchor/location id within the source pane to scroll to. */
  anchor?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  /** True while the assistant message is still streaming in. */
  streaming?: boolean;
}

interface SourceChatProps {
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

const SUGGESTED_PROMPTS = [
  "Summarize key claims",
  "Find cited examples",
  "Create study notes",
];

// Canned answers used until the real AI assistant is connected.
const MOCK_ANSWERS: { content: string; citations: Citation[] }[] = [
  {
    content:
      "The source argues that modern AI systems are no longer static tools but something closer to new minds, so building them responsibly requires five commitments: good teaching, care, honesty, patience, and imagination.",
    citations: [{ label: "This source · Intro", anchor: "top" }],
  },
  {
    content:
      "Before Gutenberg, copying a manuscript was the exclusive domain of monks and trained scholars. The source notes the printing press changed that in 1440 by putting text production in the hands of everyday people — with consequences far larger than anyone anticipated.",
    citations: [{ label: "This source · ¶5", anchor: "top" }],
  },
];

let idCounter = 0;
const nextId = () => `m-${Date.now()}-${idCounter++}`;

export default function SourceChat({
  sourceTitle,
  collapsed,
  onCitationClick,
  onClose,
  rootedInStrip,
}: SourceChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const turnRef = useRef(0);
  const threadRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasConversation = messages.length > 0;

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

  const streamAnswer = (answer: { content: string; citations: Citation[] }) => {
    const assistantId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", streaming: true },
    ]);

    const words = answer.content.split(" ");
    let i = 0;
    const interval = setInterval(() => {
      i += 1;
      const partial = words.slice(0, i).join(" ");
      const done = i >= words.length;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                content: partial,
                streaming: !done,
                citations: done ? answer.citations : undefined,
              }
            : m
        )
      );
      if (done) {
        clearInterval(interval);
        setIsStreaming(false);
      }
    }, 28);
  };

  const sendMessage = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: trimmed },
    ]);
    setInput("");
    setIsStreaming(true);

    const answer = MOCK_ANSWERS[turnRef.current % MOCK_ANSWERS.length];
    turnRef.current += 1;
    // Brief delay to show the typing indicator before streaming begins.
    setTimeout(() => streamAnswer(answer), 550);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleNewChat = () => {
    if (isStreaming) return;
    setMessages([]);
    setInput("");
    turnRef.current = 0;
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
          {!hasConversation ? (
            <EmptyState onPick={(p) => sendMessage(p)} />
          ) : (
            messages.map((m) =>
              m.role === "user" ? (
                <UserBubble key={m.id} content={m.content} />
              ) : (
                <AssistantBubble
                  key={m.id}
                  message={m}
                  onCitationClick={onCitationClick}
                />
              )
            )
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
              placeholder="Ask a question about this source…"
              className="max-h-40 flex-1 resize-none bg-transparent py-1.5 text-sm text-[#111827] outline-none placeholder:text-[#9CA3AF]"
            />
            <button
              onClick={() => sendMessage(input)}
              disabled={!input.trim() || isStreaming}
              aria-label="Send message"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand text-white transition-colors hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-40"
            >
              <SendIcon />
            </button>
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

function EmptyState({ onPick }: { onPick: (prompt: string) => void }) {
  return (
    <div className="flex flex-col items-start gap-4 py-6">
      <p className="text-sm text-[#6B7280]">
        Ask anything about this source. Every answer is grounded in — and cites
        — this document.
      </p>
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

function AssistantBubble({
  message,
  onCitationClick,
}: {
  message: ChatMessage;
  onCitationClick?: (citation: Citation) => void;
}) {
  return (
    <div className="flex max-w-[85%] gap-2.5">
      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#E7F1F2]">
        <SparkleIcon size={13} color="#147885" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="rounded-[14px] rounded-tl-[4px] bg-[#F3F4F6] px-4 py-3 text-sm leading-5 text-[#374151]">
          {message.content}
          {message.streaming && <TypingCursor empty={!message.content} />}
        </div>
        {message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {message.citations.map((c, i) => (
              <button
                key={i}
                onClick={() => onCitationClick?.(c)}
                className="flex items-center gap-1.5 rounded-md border border-[#E5E7EB] bg-white px-2.5 py-1 text-xs font-medium text-[#147885] transition-colors hover:bg-[#E7F1F2]"
              >
                <DocIcon className="text-[#147885]" />
                {c.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
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
