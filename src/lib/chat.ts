import { streamChat, type ChatMessage, type LLMUsage } from "./llm";

export const REFUSAL_TEXT = "I don't have that in this source.";

/** Hard cap on document chars sent in full-context mode. ~350k chars ≈ 87k
 *  tokens — well within Gemini Flash (1M) and gpt-4o (128k) windows. */
export const FULL_CONTEXT_MAX_CHARS = 350_000;

export interface PriorMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantCitation {
  /** Chunk id used for in-reader scroll anchoring (null if unindexed). */
  chunkId: string | null;
  ord: number | null;
  headingPath: string | null;
  label: string;
  /** Line range as cited by the model (1-indexed, inclusive). Full-context
   *  mode only — omitted in legacy retrieval mode. */
  lineStart?: number;
  lineEnd?: number;
  /** Character offsets in the source content. Full-context mode only. */
  charStart?: number;
  charEnd?: number;
}

/** Minimal chunk info needed to resolve a line citation to a reader anchor. */
export interface ChunkAnchor {
  id: string;
  ord: number;
  headingPath: string | null;
  charStart: number;
  charEnd: number;
}

/**
 * Returns true if the model's text is (or should be treated as) a refusal.
 */
export function isRefusal(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (t.length === 0) return true;
  if (t.startsWith(REFUSAL_TEXT.toLowerCase().slice(0, 20))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// FULL-CONTEXT MODE
// ---------------------------------------------------------------------------
// We send the entire source document with line numbers and let the model
// synthesize freely. Citations come back as `[L42-L58]` line ranges and are
// resolved to char offsets + nearest chunk anchor for in-reader scrolling.

function buildFullContextSystemPrompt(): string {
  return [
    "You are an expert research assistant helping the user understand a single source document. The full document is provided below with line numbers (`Ln: ...`).",
    "",
    "HOW TO ANSWER:",
    "- Synthesize cohesively. When summarizing, open with a thesis sentence that names the author (if known) and the document's central argument.",
    "- Prefer flowing prose with bolded key terms or short verbatim phrases (1–3 words) from the source. Use bullets only when the user asks for a list or when comparing distinct items.",
    "- Include concrete details: names, numbers, examples, and the source's own framing. Avoid vague paraphrase.",
    "- Match the depth the question asks for. A summary should feel substantive; a focused question should be tight and direct.",
    "- Cite supporting passages inline with line ranges, like `[L42-L58]`, placed at the end of the claim. Keep ranges small and focused (≤ 25 lines is ideal). Multiple ranges in one bracket: `[L42-L58, L120-L130]`. Don't over-cite — one citation per claim is enough.",
    "- The `Ln:` prefixes are formatting metadata; don't quote them in your answer.",
    "",
    "GROUNDING RULES:",
    "- Use ONLY the document below. No outside knowledge, definitions, or examples.",
    "- Don't speculate or extrapolate beyond what the document states.",
    `- If the document genuinely doesn't address the question, reply with EXACTLY this sentence and nothing else: "${REFUSAL_TEXT}"`,
  ].join("\n");
}

/** Prefix each line with `Ln: `. Returns the numbered text plus per-line char
 *  offsets so we can map line ranges back to character positions. */
function numberLines(content: string): {
  numbered: string;
  lineStarts: number[];
  lineLengths: number[];
} {
  const lines = content.split("\n");
  const lineStarts: number[] = new Array(lines.length);
  const lineLengths: number[] = new Array(lines.length);
  const out: string[] = new Array(lines.length);
  let cursor = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts[i] = cursor;
    lineLengths[i] = lines[i].length;
    out[i] = `L${i + 1}: ${lines[i]}`;
    cursor += lines[i].length + 1; // +1 for the stripped newline
  }
  return { numbered: out.join("\n"), lineStarts, lineLengths };
}

/** Parsed line-range citation as returned by the model. */
export interface LineCitationSpan {
  lineStart: number;
  lineEnd: number;
  charStart: number;
  charEnd: number;
}

/** Parse `[L12-L34]`, `[L12-L34, L50-L60]`, `[L12, L20-L25]`, and singletons
 *  like `[L42]`. Returns deduped spans in document order, clamped to range. */
export function parseLineCitations(
  text: string,
  lineStarts: number[],
  lineLengths: number[]
): LineCitationSpan[] {
  const totalLines = lineStarts.length;
  const out: LineCitationSpan[] = [];
  const seen = new Set<string>();

  // Match `[ ... ]` blocks that look like citations (contain at least one digit
  // run). Tolerant of `[L42-L58]`, `[42-58]`, and `[Lines 42–58]` variants.
  const bracketRe = /\[([^\]\[]*\d+[^\]\[]*)\]/g;
  // Inside a bracket, match `Lxx[–-]Lyy`, `Lxx[–-]yy`, or singleton `Lxx`/`xx`.
  // Accept ASCII hyphen, en-dash (–), em-dash (—), and Unicode minus (−).
  const itemRe = /L?(\d+)(?:\s*[-–—−]\s*L?(\d+))?/gi;

  let bm: RegExpExecArray | null;
  while ((bm = bracketRe.exec(text)) !== null) {
    let im: RegExpExecArray | null;
    itemRe.lastIndex = 0;
    while ((im = itemRe.exec(bm[1])) !== null) {
      const a = parseInt(im[1], 10);
      const b = im[2] ? parseInt(im[2], 10) : a;
      if (Number.isNaN(a) || Number.isNaN(b)) continue;
      const ls = Math.max(1, Math.min(a, b));
      const le = Math.max(1, Math.max(a, b));
      if (ls > totalLines) continue;
      const clampedEnd = Math.min(le, totalLines);
      const key = `${ls}-${clampedEnd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const charStart = lineStarts[ls - 1];
      const charEnd =
        lineStarts[clampedEnd - 1] + lineLengths[clampedEnd - 1];
      out.push({
        lineStart: ls,
        lineEnd: clampedEnd,
        charStart,
        charEnd,
      });
    }
  }

  return out.sort((a, b) => a.lineStart - b.lineStart);
}

/** Map line-range citations to chunk anchors for in-reader scrolling. */
export function resolveCitationsToChunks(
  spans: LineCitationSpan[],
  chunks: ChunkAnchor[]
): AssistantCitation[] {
  if (spans.length === 0) return [];

  const sorted = [...chunks].sort((a, b) => a.charStart - b.charStart);

  return spans.map((span) => {
    // Prefer a chunk that contains the citation's start char; fall back to the
    // chunk whose midpoint is closest to it.
    let best: ChunkAnchor | null = null;
    for (const c of sorted) {
      if (span.charStart >= c.charStart && span.charStart < c.charEnd) {
        best = c;
        break;
      }
    }
    if (!best && sorted.length > 0) {
      let bestDist = Infinity;
      for (const c of sorted) {
        const mid = (c.charStart + c.charEnd) / 2;
        const d = Math.abs(mid - span.charStart);
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
    }

    const label =
      best?.headingPath ?? `Lines ${span.lineStart}–${span.lineEnd}`;

    return {
      chunkId: best?.id ?? null,
      ord: best?.ord ?? null,
      headingPath: best?.headingPath ?? null,
      label,
      lineStart: span.lineStart,
      lineEnd: span.lineEnd,
      charStart: span.charStart,
      charEnd: span.charEnd,
    };
  });
}

export interface StreamFullContextArgs {
  question: string;
  sourceContent: string;
  sourceTitle: string | null;
  sourceAuthor: string | null;
  chunks: ChunkAnchor[];
  history: PriorMessage[];
  /** Cancellation signal — propagated to the underlying LLM call. */
  signal?: AbortSignal;
  /** Fired once usage stats are available (end of stream). */
  onUsage?: (usage: LLMUsage) => void;
  /** Fired right before the first generated token is yielded. */
  onFirstToken?: () => void;
  /** Fired if the input was truncated to fit the context budget. */
  onTruncated?: (info: { originalChars: number; truncatedTo: number }) => void;
}

/**
 * Streams a synthesized answer using the FULL source document as context.
 * Yields {type:"token", value} for each delta and
 * {type:"final", value:{text, citations}} when complete.
 */
export async function* streamFullContextAnswer({
  question,
  sourceContent,
  sourceTitle,
  sourceAuthor,
  chunks,
  history,
  signal,
  onUsage,
  onFirstToken,
  onTruncated,
}: StreamFullContextArgs): AsyncGenerator<
  | { type: "token"; value: string }
  | { type: "final"; value: { text: string; citations: AssistantCitation[] } }
> {
  let docToSend = sourceContent;
  let truncationNote = "";
  if (docToSend.length > FULL_CONTEXT_MAX_CHARS) {
    onTruncated?.({
      originalChars: docToSend.length,
      truncatedTo: FULL_CONTEXT_MAX_CHARS,
    });
    docToSend = docToSend.slice(0, FULL_CONTEXT_MAX_CHARS);
    truncationNote = `\n\n[NOTE: document was truncated to the first ${FULL_CONTEXT_MAX_CHARS} characters because it exceeds the context budget.]`;
  }

  const { numbered, lineStarts, lineLengths } = numberLines(docToSend);

  const headerParts: string[] = [];
  if (sourceTitle) headerParts.push(`TITLE: ${sourceTitle}`);
  if (sourceAuthor) headerParts.push(`AUTHOR: ${sourceAuthor}`);
  const header = headerParts.length > 0 ? headerParts.join("\n") + "\n\n" : "";

  const messages: ChatMessage[] = [
    { role: "system", content: buildFullContextSystemPrompt() },
    ...history.slice(-6).map((m) => ({ role: m.role, content: m.content })),
    {
      role: "user",
      content: `${header}DOCUMENT (with line numbers):\n\n${numbered}${truncationNote}\n\n---\n\nQUESTION: ${question}`,
    },
  ];

  let full = "";
  let firstTokenSent = false;
  // temperature: 0 for deterministic answers — same question yields same answer.
  for await (const delta of streamChat({
    messages,
    temperature: 0,
    signal,
    onUsage,
  })) {
    if (!firstTokenSent) {
      firstTokenSent = true;
      onFirstToken?.();
    }
    full += delta;
    yield { type: "token", value: delta };
  }

  const spans = parseLineCitations(full, lineStarts, lineLengths);
  const citations = resolveCitationsToChunks(spans, chunks);

  yield { type: "final", value: { text: full, citations } };
}
