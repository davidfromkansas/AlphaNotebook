/**
 * Markdown-aware chunker.
 *
 * Strategy:
 *  - Walk the document, tracking the current heading path (H1 > H2 > H3 ...).
 *  - Greedily accumulate paragraphs into a chunk until ~targetChars is reached.
 *  - Keep ~overlapChars from the tail of the previous chunk for context continuity.
 *  - Record each chunk's character span in the original document so we can scroll/highlight.
 *
 * Token-aware sizing is approximated via chars (1 token ~= 4 chars for English).
 * Target ~600 tokens => ~2400 chars; overlap ~80 tokens => ~320 chars.
 */

export interface MarkdownChunk {
  ord: number;
  headingPath: string | null;
  text: string;
  charStart: number;
  charEnd: number;
}

interface Block {
  text: string;
  start: number;
  end: number;
  isHeading: boolean;
  headingLevel: number;
  headingText: string;
}

const TARGET_CHARS = 2400;
const MAX_CHARS = 3200;
const OVERLAP_CHARS = 320;

function splitBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.split(/\r?\n/);

  let i = 0;
  let charCursor = 0;
  const lineStarts: number[] = [];
  for (const line of lines) {
    lineStarts.push(charCursor);
    charCursor += line.length + 1; // +1 for newline
  }

  while (i < lines.length) {
    // Skip empty lines
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;

    const startLine = i;
    const startChar = lineStarts[startLine];

    // Heading?
    const headingMatch = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const endChar = lineStarts[i] + lines[i].length;
      blocks.push({
        text: lines[i],
        start: startChar,
        end: endChar,
        isHeading: true,
        headingLevel: headingMatch[1].length,
        headingText: headingMatch[2].trim(),
      });
      i++;
      continue;
    }

    // Paragraph / code block / list — read until blank line or next heading
    let inFence = false;
    while (i < lines.length) {
      const line = lines[i];
      if (line.startsWith("```")) inFence = !inFence;
      if (!inFence && line.trim() === "") break;
      if (!inFence && /^#{1,6}\s+/.test(line) && i !== startLine) break;
      i++;
    }
    const endLine = Math.max(startLine, i - 1);
    const endChar = lineStarts[endLine] + lines[endLine].length;
    const text = lines.slice(startLine, endLine + 1).join("\n");
    blocks.push({
      text,
      start: startChar,
      end: endChar,
      isHeading: false,
      headingLevel: 0,
      headingText: "",
    });
  }

  return blocks;
}

function buildHeadingPath(stack: { level: number; text: string }[]): string | null {
  if (stack.length === 0) return null;
  return stack.map((h) => h.text).join(" › ");
}

export function chunkMarkdown(md: string): MarkdownChunk[] {
  const blocks = splitBlocks(md);
  const chunks: MarkdownChunk[] = [];
  const headingStack: { level: number; text: string }[] = [];

  let buf: string[] = [];
  let bufStart: number | null = null;
  let bufEnd: number | null = null;
  let bufHeading: string | null = null;
  let ord = 0;

  const flush = () => {
    if (buf.length === 0 || bufStart === null || bufEnd === null) return;
    const text = buf.join("\n\n").trim();
    if (text.length === 0) {
      buf = [];
      bufStart = null;
      bufEnd = null;
      return;
    }
    chunks.push({
      ord: ord++,
      headingPath: bufHeading,
      text,
      charStart: bufStart,
      charEnd: bufEnd,
    });
    buf = [];
    bufStart = null;
    bufEnd = null;
  };

  for (const block of blocks) {
    if (block.isHeading) {
      // Flush current chunk before switching heading context.
      flush();
      while (
        headingStack.length > 0 &&
        headingStack[headingStack.length - 1].level >= block.headingLevel
      ) {
        headingStack.pop();
      }
      headingStack.push({ level: block.headingLevel, text: block.headingText });
      bufHeading = buildHeadingPath(headingStack);
      continue;
    }

    // Oversized block: flush current buffer, then emit hard-splits directly.
    if (block.text.length > MAX_CHARS) {
      flush();
      const text = block.text;
      let cursor = 0;
      while (cursor < text.length) {
        const piece = text.slice(cursor, cursor + MAX_CHARS);
        chunks.push({
          ord: ord++,
          headingPath: buildHeadingPath(headingStack),
          text: piece,
          charStart: block.start + cursor,
          charEnd: block.start + cursor + piece.length,
        });
        cursor += MAX_CHARS;
      }
      continue;
    }

    const candidateLen =
      (buf.length === 0 ? 0 : buf.join("\n\n").length + 2) + block.text.length;

    if (candidateLen > MAX_CHARS && buf.length > 0) {
      flush();
    } else if (candidateLen > TARGET_CHARS && buf.length > 0) {
      flush();
    }

    if (buf.length === 0) {
      bufStart = block.start;
      bufHeading = buildHeadingPath(headingStack);
    }
    buf.push(block.text);
    bufEnd = block.end;
  }
  flush();

  // Add overlap (prepend tail of previous chunk to each chunk's text for embedding context,
  // but do NOT extend charStart/charEnd — those track the canonical span).
  return chunks.map((c, i) => {
    if (i === 0) return c;
    const prev = chunks[i - 1];
    const overlap = prev.text.slice(-OVERLAP_CHARS);
    return {
      ...c,
      text: `${overlap}\n\n${c.text}`,
    };
  });
}
