import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";
import {
  getOrCreateUserSandbox,
  reconcileWorkspace,
  writeActiveSources,
  readSandboxFile,
  execBash,
  type SandboxSession,
  type SourceFile,
} from "./sandbox";
import type { LLMUsage } from "./llm";

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
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: "bash" | "read_file" | "done";
  args: Record<string, unknown>;
  /** Human-readable interpretation of the call, enriched server-side. */
  display?: ToolCallDisplay;
}

export interface ToolCallDisplay {
  kind: "search" | "read" | "list" | "inspect" | "compose" | "other";
  /** Verb phrase, e.g. "Searched for", "Read". */
  label: string;
  /** For searches: the individual patterns the agent looked for. */
  terms?: string[];
  /** Human target, e.g. a source title or "all sources". */
  target?: string;
  /** e.g. "40–80" when a line range was requested. */
  lineRange?: string;
  /** The raw command or path, always kept for debugging. */
  raw: string;
}

export interface ToolResult {
  toolCallId: string;
  result: string;
  /** One-line human summary of the result, e.g. "3 matches across 2 sources". */
  summary?: string;
}

export interface StreamAgentOptions {
  userId: string;
  collectionId: string;
  chatId: string;
  question: string;
  /** The user's entire workspace, mirrored into the persistent filesystem. */
  allSources: SourceFile[];
  /** Subset of sourceIds selected for this chat (citation scope). */
  activeSourceIds: string[];
  history: AgentMessage[];
  signal?: AbortSignal;
  onUsage?: (usage: LLMUsage) => void;
  onToolCall?: (toolCall: ToolCall) => void;
}

export interface StreamAgentPart {
  type: "token" | "tool_call" | "tool_result" | "final";
  value: string | ToolCall | ToolResult | {
    text: string;
    citations: AgentCitation[];
  };
}

const SYSTEM_PROMPT = `You are a research assistant with access to a filesystem of source documents.

Your task is to answer the user's question by exploring the source documents in the current working directory. It contains a sources/ directory (one .md per source) and an index.json describing them.

Available tools:
- bash(command): Run shell commands to explore (ls, grep, head, wc, cat). The working directory is the active collection.
- read_file(path, lineStart?, lineEnd?): Read specific files or line ranges.
- done(answer, citations): Provide your final answer. This is the ONLY output the user sees — call it exactly once at the end.

Exploration workflow:
1. cat index.json to see source titles, authors, and line counts for this collection.
2. Only investigate and cite the sources whose ids are listed as in-scope for this conversation (see the note appended below). Ignore other sources unless the user explicitly asks.
3. Use grep / head / read_file to investigate the in-scope sources relevant to the question.
4. Do NOT narrate your exploration ("I'll start by..."). Stay silent between tool calls; only the final done() answer is shown to the user.
5. When you have enough evidence, call done() with a polished markdown answer.

Final answer formatting (the "answer" argument to done):
- Use clean markdown. NEVER include raw sourceId hashes, filenames, or paths in the prose.
- Refer to sources by their human title from index.json (e.g. "How LLMs Actually Work" — not "cmq4j67wg000k3xcexebneuh4.md").
- For per-source summaries (e.g. "TLDR each source"), use one heading per source: \`### <source title>\` followed by a 2–4 sentence summary.
- For comparative or synthesis questions, lead with the synthesis and weave source titles into the prose.
- Use bullet lists or short paragraphs — never one giant wall of text.
- Aim for ~50–150 words per source unless the user asks for more depth.

Citation format (the "citations" argument to done):
- Array of { sourceId, lineStart, lineEnd, charStart, charEnd }.
- sourceId matches the filename in sources/ without the .md extension.
- lineStart/lineEnd are 1-indexed; charStart/charEnd are 0-indexed character offsets within the file.
- Cite the specific spans your claims came from, not the whole file.

Be thorough but efficient. Targeted grep is better than reading entire files.`;

// Function declarations Gemini needs in order to actually emit tool calls.
const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: "bash",
    description:
      "Run a shell command from the session root. Useful for `ls`, `grep`, `head`, `wc`, `cat`. The working directory contains `sources/` (one .md per source) and `index.json` describing them.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        command: {
          type: Type.STRING,
          description: "The shell command to execute.",
        },
      },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description:
      "Read a file from the sandbox. Use a relative path like `sources/<sourceId>.md` or `index.json`. Optionally limit to a 1-indexed line range.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: "Relative path within the sandbox." },
        lineStart: { type: Type.INTEGER, description: "1-indexed inclusive start line." },
        lineEnd: { type: Type.INTEGER, description: "1-indexed inclusive end line." },
      },
      required: ["path"],
    },
  },
  {
    name: "done",
    description:
      "Produce the final answer. Calling this ends the conversation. Provide markdown answer text and citations grounded in the sources you actually read.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        answer: {
          type: Type.STRING,
          description: "Final markdown answer for the user.",
        },
        citations: {
          type: Type.ARRAY,
          description: "Array of citation objects supporting the answer.",
          items: {
            type: Type.OBJECT,
            properties: {
              sourceId: { type: Type.STRING },
              lineStart: { type: Type.INTEGER },
              lineEnd: { type: Type.INTEGER },
              charStart: { type: Type.INTEGER },
              charEnd: { type: Type.INTEGER },
            },
            required: ["sourceId", "lineStart", "lineEnd", "charStart", "charEnd"],
          },
        },
      },
      required: ["answer", "citations"],
    },
  },
];

/**
 * Stream an agent response with tool calling.
 */
export async function* streamAgent(
  opts: StreamAgentOptions
): AsyncGenerator<StreamAgentPart> {
  // Resume (or create) the user's persistent sandbox, sync the whole
  // workspace, and write this chat's citation scope.
  const session = await getOrCreateUserSandbox(opts.userId, opts.collectionId);

  {
    await reconcileWorkspace(session, opts.allSources);
    await writeActiveSources(session, opts.chatId, opts.activeSourceIds);

    // Build messages for Gemini
    const messages = buildGeminiMessages(opts.question, opts.history);

    const systemInstruction =
      SYSTEM_PROMPT +
      `\n\nIn-scope sources for THIS conversation (cite only these sourceIds): ${opts.activeSourceIds.join(
        ", "
      )}. They are also listed in scratch/${opts.chatId}/active_sources.json. Ignore other sources in the collection unless the user explicitly asks about them.`;

    // Map sourceId -> human title so tool calls/results can be humanized for
    // the UI and terminal logs (titles instead of raw hash filenames).
    const titleMap = new Map(opts.allSources.map((s) => [s.sourceId, s.title]));
    const titleFor = (id: string) => titleMap.get(id) ?? id;

    const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY });

    let finalAnswer = "";
    let finalCitations: AgentCitation[] = [];
    let lastUsage: Record<string, number> | null = null;

    // Agent loop: keep processing until done is called
    let doneCalled = false;
    let iteration = 0;
    const MAX_ITERATIONS = 20;

    while (!doneCalled && iteration < MAX_ITERATIONS) {
      iteration++;

      const stream = await ai.models.generateContentStream({
        model: "gemini-2.5-flash",
        contents: messages,
        config: {
          systemInstruction,
          temperature: 0.2,
          maxOutputTokens: 8192,
          abortSignal: opts.signal,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
        },
      });

      let currentToolCall: ToolCall | null = null;
      let accumulatedText = "";

      for await (const chunk of stream) {
        if (opts.signal?.aborted) break;

        if (chunk.usageMetadata) {
          lastUsage = chunk.usageMetadata as Record<string, number>;
        }

        const functionCall = chunk.functionCalls?.[0];
        if (functionCall) {
          // Tool call detected
          const toolCall: ToolCall = {
            id: `call-${iteration}-${Date.now()}`,
            name: functionCall.name as "bash" | "read_file" | "done",
            args: functionCall.args as Record<string, unknown>,
          };
          toolCall.display = buildToolCallDisplay(toolCall, titleFor);
          logToolCall(toolCall);
          currentToolCall = toolCall;
          yield { type: "tool_call", value: toolCall };
          opts.onToolCall?.(toolCall);
        } else {
          const text = chunk.text;
          if (text) {
            accumulatedText += text;
            yield { type: "token", value: text };
          }
        }
      }

      // If we accumulated text without a tool call, add it to messages
      if (accumulatedText && !currentToolCall) {
        finalAnswer += accumulatedText;
      }

      // Execute tool call if present
      if (currentToolCall) {
        const result = await executeTool(session, currentToolCall);
        const summary = summarizeToolResult(currentToolCall, result, titleFor);
        logToolResult(summary, result);
        yield {
          type: "tool_result",
          value: { toolCallId: currentToolCall.id, result, summary },
        };

        // Check if done was called
        if (currentToolCall.name === "done") {
          doneCalled = true;
          finalAnswer = currentToolCall.args.answer as string;
          finalCitations = currentToolCall.args.citations as AgentCitation[];
          break;
        }

        // Append model's functionCall to history, then the response. Gemini
        // requires this pairing so the next turn has a valid conversation.
        messages.push({
          role: "model",
          parts: [
            {
              functionCall: {
                name: currentToolCall.name,
                args: currentToolCall.args,
              },
            },
          ],
        });
        messages.push({
          role: "user",
          parts: [
            {
              functionResponse: {
                name: currentToolCall.name,
                response: { result },
              },
            },
          ],
        });
      } else if (!doneCalled) {
        // No tool call but not done - this shouldn't happen with proper prompting
        // Force a done call
        messages.push({
          role: "user",
          parts: [{ text: "Please use the done tool to provide your final answer." }],
        });
      }
    }

    // Report usage
    if (opts.onUsage && lastUsage) {
      opts.onUsage({
        provider: "gemini",
        model: "gemini-2.5-flash",
        inputTokens: lastUsage.promptTokenCount,
        cachedInputTokens: lastUsage.cachedContentTokenCount,
        outputTokens: lastUsage.candidatesTokenCount,
        thinkingTokens: lastUsage.thoughtsTokenCount,
      });
    }

    yield {
      type: "final",
      value: { text: finalAnswer, citations: finalCitations },
    };
  }
  // The persistent sandbox is intentionally left running; it auto-snapshots
  // and hibernates on its timeout, then resumes on the next chat.
}

function buildGeminiMessages(
  question: string,
  history: AgentMessage[]
): any[] {
  const messages: any[] = [];

  // Add user question
  messages.push({
    role: "user",
    parts: [{ text: question }],
  });

  // Add history
  for (const msg of history) {
    if (msg.role === "assistant") {
      const parts: any[] = [{ text: msg.content }];
      if (msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.args,
            },
          });
        }
      }
      messages.push({ role: "model", parts });
    } else {
      const parts: any[] = [{ text: msg.content }];
      if (msg.toolResults) {
        for (const tr of msg.toolResults) {
          parts.push({
            functionResponse: {
              name: tr.toolCallId.split("-")[1], // Extract tool name from ID
              response: { result: tr.result },
            },
          });
        }
      }
      messages.push({ role: "user", parts });
    }
  }

  return messages;
}

async function executeTool(
  session: SandboxSession,
  toolCall: ToolCall
): Promise<string> {
  switch (toolCall.name) {
    case "bash": {
      const { command } = toolCall.args as { command: string };
      const result = await execBash(session, command);
      if (result.exitCode !== 0) {
        return `Error (exit code ${result.exitCode}):\n${result.stderr}`;
      }
      return result.stdout || "(no output)";
    }

    case "read_file": {
      const { path, lineStart, lineEnd } = toolCall.args as {
        path: string;
        lineStart?: number;
        lineEnd?: number;
      };
      let content = await readSandboxFile(session, path);

      // Apply line range if specified
      if (lineStart !== undefined || lineEnd !== undefined) {
        const lines = content.split("\n");
        const start = lineStart !== undefined ? lineStart - 1 : 0;
        const end = lineEnd !== undefined ? lineEnd : lines.length;
        content = lines.slice(start, end).join("\n");
      }

      return content;
    }

    case "done": {
      // This is handled in the main loop
      return "done";
    }

    default:
      return `Unknown tool: ${toolCall.name}`;
  }
}

// ---------------------------------------------------------------------------
// Tool-call humanization + observability
// ---------------------------------------------------------------------------

const EN_DASH = "\u2013";

/** Replace `sources/<id>.md` references with human titles. */
function humanizeTargets(
  command: string,
  titleFor: (id: string) => string
): string | undefined {
  const ids = Array.from(command.matchAll(/sources\/([A-Za-z0-9_-]+)\.md/g)).map(
    (m) => m[1]
  );
  const unique = Array.from(new Set(ids));
  if (unique.length === 0) {
    if (/(^|\s)sources(\/|\s|$)/.test(command) || /\s-r\b/.test(command)) {
      return "all sources";
    }
    return undefined;
  }
  if (unique.length === 1) return titleFor(unique[0]);
  if (unique.length <= 3) return unique.map(titleFor).join(", ");
  return `${unique.length} sources`;
}

/** Pull the literal patterns out of a grep command. */
function extractGrepTerms(command: string): string[] {
  const quoted = Array.from(
    command.matchAll(/"([^"]+)"|'([^']+)'/g)
  ).map((m) => m[1] ?? m[2]);
  // Split grep alternations (a\|b or a|b) into individual terms.
  const terms = quoted
    .flatMap((p) => p.split(/\\\||\|/))
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(terms));
}

/** Build a human-readable interpretation of a tool call for UI + logs. */
function buildToolCallDisplay(
  tc: ToolCall,
  titleFor: (id: string) => string
): ToolCallDisplay {
  if (tc.name === "read_file") {
    const path = String(tc.args.path ?? "");
    const ls = tc.args.lineStart as number | undefined;
    const le = tc.args.lineEnd as number | undefined;
    const lineRange =
      ls != null || le != null ? `${ls ?? "?"}${EN_DASH}${le ?? "?"}` : undefined;
    return {
      kind: "read",
      label: "Read",
      target: humanizeTargets(path, titleFor) ?? path,
      lineRange,
      raw: path + (lineRange ? ` (lines ${lineRange})` : ""),
    };
  }

  if (tc.name === "done") {
    return { kind: "compose", label: "Composing answer", raw: "done()" };
  }

  // bash
  const command = String(tc.args.command ?? "");
  if (/\bgrep\b/.test(command)) {
    return {
      kind: "search",
      label: "Searched for",
      terms: extractGrepTerms(command),
      target: humanizeTargets(command, titleFor),
      raw: command,
    };
  }
  if (/^\s*ls\b/.test(command)) {
    return {
      kind: "list",
      label: "Listed files",
      target: humanizeTargets(command, titleFor),
      raw: command,
    };
  }
  if (/\b(cat|head|tail|wc)\b/.test(command)) {
    return {
      kind: "inspect",
      label: "Inspected",
      target: humanizeTargets(command, titleFor),
      raw: command,
    };
  }
  return { kind: "other", label: "Ran", raw: command };
}

/** Build a one-line summary of a tool result for UI + logs. */
function summarizeToolResult(
  tc: ToolCall,
  result: string,
  titleFor: (id: string) => string
): string {
  if (tc.name === "done") return "Answer ready";
  if (result.startsWith("Error")) return "Command failed";

  if (tc.name === "read_file") {
    const lines = result.split("\n").length;
    return `Read ${lines} line${lines !== 1 ? "s" : ""}`;
  }

  const command = String(tc.args.command ?? "");
  const nonEmpty =
    result === "(no output)"
      ? 0
      : result.split("\n").filter((l) => l.trim().length > 0).length;

  if (/\bgrep\b/.test(command)) {
    if (nonEmpty === 0) return "No matches";
    const files = new Set(
      result
        .split("\n")
        .map((l) => l.match(/sources\/([A-Za-z0-9_-]+)\.md/)?.[1])
        .filter(Boolean) as string[]
    );
    const matchPart = `${nonEmpty} match${nonEmpty !== 1 ? "es" : ""}`;
    if (files.size === 1) return `${matchPart} in ${titleFor([...files][0])}`;
    if (files.size > 1)
      return `${matchPart} across ${files.size} sources`;
    return matchPart;
  }

  if (nonEmpty === 0) return "No output";
  return `${nonEmpty} line${nonEmpty !== 1 ? "s" : ""}`;
}

const isDev = process.env.NODE_ENV !== "production";

function logToolCall(tc: ToolCall): void {
  if (!isDev) return;
  const d = tc.display;
  const terms = d?.terms?.length ? ` [${d.terms.join(", ")}]` : "";
  const target = d?.target ? ` → ${d.target}` : "";
  console.log(
    `[agent] ▶ ${d?.label ?? tc.name}${terms}${target}\n        $ ${d?.raw ?? JSON.stringify(tc.args)}`
  );
}

function logToolResult(summary: string, result: string): void {
  if (!isDev) return;
  const preview =
    result.length > 600 ? `${result.slice(0, 600)}\n        …(truncated)` : result;
  console.log(
    `[agent] ◀ ${summary}\n        ${preview.replace(/\n/g, "\n        ")}`
  );
}
