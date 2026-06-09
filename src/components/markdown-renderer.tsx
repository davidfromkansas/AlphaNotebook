"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export interface ChunkSpan {
  id: string;
  ord: number;
  charStart: number;
  charEnd: number;
  headingPath: string | null;
}

interface MarkdownRendererProps {
  content: string;
  /** When provided, content is split by chunk spans so each chunk becomes a
   *  scrollable anchor (id=`chunk-{id}`, data-chunk-id=`{id}`). */
  chunks?: ChunkSpan[];
  /** When set, that chunk gets a brief highlight animation. */
  activeChunkId?: string | null;
  /** When set, the exact char range gets its own scrollable, highlighted
   *  anchor (id=`range-{key}`). Used for line-precise citation jumps. */
  activeRange?: {
    key: string;
    charStart: number;
    charEnd: number;
  } | null;
}

const MD_COMPONENTS = {
  a: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand hover:underline"
      {...props}
    >
      {children}
    </a>
  ),
};

interface Segment {
  text: string;
  chunkId?: string;
  rangeKey?: string;
  isRange?: boolean;
}

/** Split [start,end) of `content` into pre/range/post relative to `range`. */
function splitForRange(
  text: string,
  segStart: number,
  segEnd: number,
  range: { key: string; charStart: number; charEnd: number } | null | undefined,
  baseChunkId: string | undefined
): Segment[] {
  if (!range) return [{ text, chunkId: baseChunkId }];
  const overlapStart = Math.max(segStart, range.charStart);
  const overlapEnd = Math.min(segEnd, range.charEnd);
  if (overlapStart >= overlapEnd) return [{ text, chunkId: baseChunkId }];
  const out: Segment[] = [];
  if (overlapStart > segStart) {
    out.push({
      text: text.slice(0, overlapStart - segStart),
      chunkId: baseChunkId,
    });
  }
  out.push({
    text: text.slice(overlapStart - segStart, overlapEnd - segStart),
    chunkId: baseChunkId,
    rangeKey: range.key,
    isRange: true,
  });
  if (overlapEnd < segEnd) {
    out.push({
      text: text.slice(overlapEnd - segStart),
      chunkId: baseChunkId,
    });
  }
  return out;
}

export default function MarkdownRenderer({
  content,
  chunks,
  activeChunkId,
  activeRange,
}: MarkdownRendererProps) {
  // Build base chunk-aware segments, then sub-split any segment that overlaps
  // the active range so the range gets its own scroll anchor + highlight.
  const baseSegments: { text: string; start: number; chunkId?: string }[] = [];
  if (!chunks || chunks.length === 0) {
    baseSegments.push({ text: content, start: 0 });
  } else {
    const sorted = [...chunks].sort((a, b) => a.charStart - b.charStart);
    let cursor = 0;
    for (const c of sorted) {
      if (c.charStart > cursor) {
        baseSegments.push({
          text: content.slice(cursor, c.charStart),
          start: cursor,
        });
      }
      const start = Math.max(c.charStart, cursor);
      baseSegments.push({
        text: content.slice(start, c.charEnd),
        start,
        chunkId: c.id,
      });
      cursor = Math.max(cursor, c.charEnd);
    }
    if (cursor < content.length) {
      baseSegments.push({ text: content.slice(cursor), start: cursor });
    }
  }

  const segments: Segment[] = [];
  for (const b of baseSegments) {
    if (b.text.length === 0) continue;
    const segEnd = b.start + b.text.length;
    const split = splitForRange(
      b.text,
      b.start,
      segEnd,
      activeRange ?? null,
      b.chunkId
    );
    segments.push(...split);
  }

  return (
    <>
      {segments.map((seg, i) => {
        if (seg.text.length === 0) return null;
        const isActiveChunk =
          seg.chunkId && activeChunkId === seg.chunkId && !seg.isRange;
        const wrapperClass = `scroll-mt-6 rounded-md transition-colors duration-700 ${
          seg.isRange
            ? "bg-[#FEF3C7] ring-2 ring-[#F59E0B]/40"
            : isActiveChunk
              ? "bg-[#FEF3C7]"
              : "bg-transparent"
        }`;
        const id = seg.isRange
          ? `range-${seg.rangeKey}`
          : seg.chunkId
            ? `chunk-${seg.chunkId}`
            : undefined;

        // Plain prose segment outside any chunk and not the active range.
        if (!id) {
          return (
            <ReactMarkdown
              key={i}
              remarkPlugins={[remarkGfm]}
              components={MD_COMPONENTS}
            >
              {seg.text}
            </ReactMarkdown>
          );
        }

        return (
          <div
            key={`${i}-${id}`}
            id={id}
            data-chunk-id={seg.chunkId}
            data-range-key={seg.rangeKey}
            className={wrapperClass}
          >
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={MD_COMPONENTS}
            >
              {seg.text}
            </ReactMarkdown>
          </div>
        );
      })}
    </>
  );
}
