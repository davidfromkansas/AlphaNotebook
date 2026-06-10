"use client";

import { useState, useRef, useEffect } from "react";

interface LearnComposerProps {
  placeholder?: string;
  onSubmit?: (value: string) => void;
  isLoading?: boolean;
}

export function LearnComposer({
  placeholder = "I want to learn...",
  onSubmit,
  isLoading = false,
}: LearnComposerProps) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea with its content.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [value]);

  const canSubmit = value.trim().length > 0 && !isLoading;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit?.(value.trim());
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-white p-4 shadow-sm transition focus-within:border-brand/60 focus-within:shadow-md">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        rows={1}
        className="block w-full resize-none border-0 bg-transparent text-lg text-foreground placeholder:text-foreground/35 focus:outline-none"
      />

      <div className="mt-3 flex items-center justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          aria-label="Send"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-foreground text-white transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:bg-foreground/25"
        >
          {isLoading ? (
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-90"
                fill="currentColor"
                d="M12 3a9 9 0 0 1 9 9h-3a6 6 0 0 0-6-6V3z"
              />
            </svg>
          ) : (
            <svg
              className="h-5 w-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}
