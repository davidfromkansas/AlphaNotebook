/**
 * Provider-agnostic chat interface.
 *
 * Today supports:
 *   - "gemini"  → Google AI Studio (Gemini 2.5 Flash by default, 1M context)
 *   - "openai"  → OpenAI (gpt-4o by default, 128k context)
 *
 * Pick a provider via the LLM_PROVIDER env var, or pass `provider` explicitly.
 */
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";

export type LLMProvider = "gemini" | "openai";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  messages: ChatMessage[];
  /** 0 = deterministic, 1 = creative. Default 0.2. */
  temperature?: number;
  /** Maximum tokens to generate. Default 16384. */
  maxOutputTokens?: number;
  /** Override the provider for this call. Defaults to LLM_PROVIDER env. */
  provider?: LLMProvider;
  /** Override the model for this call. Defaults to the provider's default. */
  model?: string;
  /** Optional cancellation signal. The underlying provider call aborts when fired. */
  signal?: AbortSignal;
  /** Optional callback fired once usage stats are available (end of stream). */
  onUsage?: (usage: LLMUsage) => void;
}

export interface LLMUsage {
  provider: LLMProvider;
  model: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
}

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

function resolveProvider(p?: LLMProvider): LLMProvider {
  if (p) return p;
  const env = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  if (env === "openai") return "openai";
  return "gemini";
}

let _gemini: GoogleGenAI | null = null;
function getGemini(): GoogleGenAI {
  if (_gemini) return _gemini;
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_AI_API_KEY is not set");
  _gemini = new GoogleGenAI({ apiKey });
  return _gemini;
}

let _openai: OpenAI | null = null;
function getOpenAIClient(): OpenAI {
  if (_openai) return _openai;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  _openai = new OpenAI({ apiKey });
  return _openai;
}

/**
 * Stream a chat completion as an async iterable of token deltas.
 *
 * Usage:
 *   for await (const delta of streamChat({ messages })) { ... }
 */
export async function* streamChat(
  opts: StreamChatOptions
): AsyncGenerator<string> {
  const provider = resolveProvider(opts.provider);
  const temperature = opts.temperature ?? 0.2;
  // Generous default — Gemini 3.x charges "thinking" against the output
  // budget, so a tight cap silently truncates real answers mid-sentence.
  const maxOutputTokens = opts.maxOutputTokens ?? 16384;

  if (provider === "gemini") {
    yield* streamGemini({
      messages: opts.messages,
      temperature,
      maxOutputTokens,
      model: opts.model ?? DEFAULT_GEMINI_MODEL,
      signal: opts.signal,
      onUsage: opts.onUsage,
    });
    return;
  }

  yield* streamOpenAI({
    messages: opts.messages,
    temperature,
    maxOutputTokens,
    model: opts.model ?? DEFAULT_OPENAI_MODEL,
    signal: opts.signal,
    onUsage: opts.onUsage,
  });
}

async function* streamGemini(args: {
  messages: ChatMessage[];
  temperature: number;
  maxOutputTokens: number;
  model: string;
  signal?: AbortSignal;
  onUsage?: (usage: LLMUsage) => void;
}): AsyncGenerator<string> {
  const ai = getGemini();

  // Gemini wants `systemInstruction` separate from the message array, and
  // uses role "model" instead of "assistant".
  const systemParts = args.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const contents = args.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

  const stream = await ai.models.generateContentStream({
    model: args.model,
    contents,
    config: {
      systemInstruction: systemParts || undefined,
      temperature: args.temperature,
      maxOutputTokens: args.maxOutputTokens,
      // Cap thinking budget so it can't eat the entire output budget. 1024
      // tokens of "thinking" is plenty for grounded synthesis and leaves the
      // rest of `maxOutputTokens` for the actual prose.
      thinkingConfig: { thinkingBudget: 1024 },
      abortSignal: args.signal,
    },
  });

  let lastChunk: unknown = null;
  for await (const chunk of stream) {
    if (args.signal?.aborted) break;
    lastChunk = chunk;
    const text = chunk.text;
    if (text) yield text;
  }

  // Gemini reports usage on the final stream chunk.
  if (args.onUsage && lastChunk) {
    const meta = (lastChunk as { usageMetadata?: Record<string, number> })
      .usageMetadata;
    if (meta) {
      args.onUsage({
        provider: "gemini",
        model: args.model,
        inputTokens: meta.promptTokenCount,
        cachedInputTokens: meta.cachedContentTokenCount,
        outputTokens: meta.candidatesTokenCount,
        thinkingTokens: meta.thoughtsTokenCount,
      });
    }
  }
}

async function* streamOpenAI(args: {
  messages: ChatMessage[];
  temperature: number;
  maxOutputTokens: number;
  model: string;
  signal?: AbortSignal;
  onUsage?: (usage: LLMUsage) => void;
}): AsyncGenerator<string> {
  const openai = getOpenAIClient();

  const stream = await openai.chat.completions.create(
    {
      model: args.model,
      messages: args.messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
      temperature: args.temperature,
      max_tokens: args.maxOutputTokens,
      stream: true,
      stream_options: { include_usage: true },
    },
    { signal: args.signal }
  );

  let usage: { prompt_tokens?: number; completion_tokens?: number } | null =
    null;
  for await (const part of stream) {
    if (args.signal?.aborted) break;
    if (part.usage) usage = part.usage;
    const delta = part.choices[0]?.delta?.content;
    if (delta) yield delta;
  }

  if (args.onUsage && usage) {
    args.onUsage({
      provider: "openai",
      model: args.model,
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
    });
  }
}

/**
 * Non-streaming convenience wrapper: run a chat completion and return the full
 * text. Buffers the streamed deltas internally.
 */
export async function completeChat(
  opts: Omit<StreamChatOptions, "onUsage">
): Promise<string> {
  let out = "";
  for await (const delta of streamChat(opts)) {
    out += delta;
  }
  return out;
}

/** Resolve the currently-configured provider + model for diagnostics. */
export function describeLLM(): { provider: LLMProvider; model: string } {
  const provider = resolveProvider();
  const model =
    provider === "gemini" ? DEFAULT_GEMINI_MODEL : DEFAULT_OPENAI_MODEL;
  return { provider, model };
}
