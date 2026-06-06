"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownRendererProps {
  content: string;
}

export default function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose-headings:text-foreground prose-p:text-foreground/80 prose-strong:text-foreground prose-a:text-brand prose-code:text-foreground/90 prose-code:bg-surface prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-pre:bg-surface prose-pre:border prose-pre:border-border prose-li:text-foreground/80 prose-td:text-foreground/80 prose-th:text-foreground">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
